// @vitest-environment node
import { expect, it } from 'vitest'
import { fixture, now } from '../../unit/contexts/nodeControlTask.fixture'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerOperationIntrospectionHandlers } from '../../../src/app/main/controlSurface/handlers/operationIntrospectionHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'

function setup(nodeId: string | null = 'agent', projectId = 'project') {
  const f = fixture()
  f.advance(s => {
    const w = s.workspaces[0]
    w.nodes.push({
      ...structuredClone(w.nodes[0]),
      id: 'agent',
      kind: 'agent',
      agent: { taskId: null },
    })
    w.nodes.push({ ...structuredClone(w.nodes[0]), id: 'note', kind: 'note', task: { text: '' } })
    w.spaces[0].nodeIds.push('agent', 'note')
  })
  const surface = createControlSurface()
  registerNodeControlHandlers(surface, {
    topology: {} as Parameters<typeof registerNodeControlHandlers>[1]['topology'],
    getPersistenceStore: async () => f.store as unknown as PersistenceStore,
  })
  registerOperationIntrospectionHandlers(surface)
  const registry = new SessionGrantRegistry(() => true)
  const { grant } = registry.issue(
    { projectId, nodeId, spaceId: 'space', sessionId: 'session' },
    now,
  )
  const ctx: ControlSurfaceContext = {
    ...createControlSurfaceHttpServerContext({
      enableWebShell: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 10,
    }),
    requestAuth: { kind: 'session-grant', grant },
  }
  const invoke = (id: string, payload: unknown, context = ctx) =>
    surface.invoke(context, { kind: id === 'system.operations' ? 'query' : 'command', id, payload })
  return { ...f, ctx, registry, grant, invoke }
}

it.each([
  ['task.claim', { taskNodeId: 'task', agentNodeId: 'agent' }],
  ['task.release', { taskNodeId: 'task', status: 'todo' }],
  ['note.append', { nodeId: 'note', text: 'text' }],
])('declares strict schema and constrained interact access for %s', async (id, payload) => {
  const f = setup()
  const operation = getControlSurfaceOperation(id)!
  expect(operation).toMatchObject({ contract: 'schema', scope: 'interact' })
  expect(await f.invoke(id, { ...payload, extra: 'untrusted' })).toMatchObject({
    ok: false,
    error: { code: 'common.invalid_input' },
  })
  expect(f.write).not.toHaveBeenCalled()
  const listed = await f.invoke('system.operations', {})
  expect(listed).toMatchObject({
    ok: true,
    value: {
      operations: expect.arrayContaining([expect.objectContaining({ id, access: 'constrained' })]),
    },
  })
})
it('wires authenticated claim, append and release without runtime effects', async () => {
  const f = setup()
  expect(await f.invoke('task.claim', { taskNodeId: 'task' })).toMatchObject({
    ok: true,
    value: { changed: true, node: { data: { linkedAgentNodeId: 'agent' } } },
  })
  expect(await f.invoke('note.append', { nodeId: 'note', text: '工作完成' })).toMatchObject({
    ok: true,
    value: { appendedBytes: 12 },
  })
  expect(await f.invoke('task.release', { taskNodeId: 'task', status: 'ai_done' })).toMatchObject({
    ok: true,
    value: { node: { data: { linkedAgentNodeId: null } } },
  })
  expect(f.state().workspaces[0].nodes.find(n => n.id === 'agent')?.agent).toMatchObject({
    taskId: null,
  })
})
it('rejects grant impersonation and allows user override', async () => {
  const f = setup()
  expect(await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'other' })).toMatchObject({
    ok: false,
    error: { code: 'common.forbidden' },
  })
  expect(await f.invoke('task.claim', { taskNodeId: 'task' })).toMatchObject({ ok: true })
  const user = { ...f.ctx, requestAuth: undefined }
  expect(
    await f.invoke('task.release', { taskNodeId: 'task', status: 'done' }, user),
  ).toMatchObject({ ok: true })
})
it.each(['task.claim', 'task.release', 'note.append'])(
  'refuses foreign project for %s',
  async id => {
    const f = setup('agent', 'foreign')
    expect(
      await f.invoke(
        id,
        id === 'note.append' ? { nodeId: 'note', text: 'x' } : { taskNodeId: 'task' },
      ),
    ).toMatchObject({ ok: false, error: { code: 'common.forbidden' } })
    expect(f.write).not.toHaveBeenCalled()
  },
)
it('permits node-less note grants but refuses node-less task claims', async () => {
  const f = setup(null)
  expect(await f.invoke('note.append', { nodeId: 'note', text: 'x' })).toMatchObject({ ok: true })
  expect(await f.invoke('task.claim', { taskNodeId: 'task' })).toMatchObject({
    ok: false,
    error: { code: 'common.forbidden' },
  })
})
it('rechecks request activity after reads so revocation prevents the write', async () => {
  const f = setup()
  const read = f.store.readAppState
  f.store.readAppState = async () => {
    const state = await read()
    f.registry.revokeSession('session')
    return state
  }
  const ctx = {
    ...f.ctx,
    assertActive: () => {
      if (!f.registry.isActive(f.grant.grantId)) {
        throw new Error('revoked')
      }
    },
  }
  expect(await f.invoke('task.claim', { taskNodeId: 'task' }, ctx)).toMatchObject({ ok: false })
  expect(f.write).not.toHaveBeenCalled()
})
it.each([null, '', 1, {}, []])('refuses invalid note text %j', async text => {
  const f = setup()
  expect(await f.invoke('note.append', { nodeId: 'note', text })).toMatchObject({
    ok: false,
    error: { code: 'common.invalid_input' },
  })
})
it('does not retry a thrown write with an unknown outcome', async () => {
  const f = setup()
  f.write.mockRejectedValueOnce(new Error('connection lost'))
  expect(await f.invoke('note.append', { nodeId: 'note', text: 'x' })).toMatchObject({
    ok: false,
    error: { code: 'persistence.io_failed' },
  })
  expect(f.write).toHaveBeenCalledTimes(1)
})
