// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { fixture, now } from '../../unit/contexts/nodeControlTask.fixture'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { NodeLineageRecord } from '../../../src/contexts/workspace/domain/nodeLineage'

function setup() {
  const f = fixture()
  const rows = new Map<string, NodeLineageRecord>([
    ['self', { nodeId: 'self', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 }],
    ['child', { nodeId: 'child', spawnedBy: 'self', rootNodeId: 'root', lineageDepth: 3 }],
    [
      'grandchild',
      { nodeId: 'grandchild', spawnedBy: 'child', rootNodeId: 'root', lineageDepth: 4 },
    ],
    ['sibling', { nodeId: 'sibling', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 }],
  ])
  f.store.nodeLineage = {
    readMany: vi.fn(
      async (ids: readonly string[]) =>
        new Map<string, NodeLineageRecord>(
          ids.flatMap(id => (rows.has(id) ? [[id, rows.get(id)!] as const] : [])),
        ),
    ),
  }
  f.advance(s => {
    for (const id of ['self', 'child', 'grandchild', 'sibling', 'unrelated']) {
      s.workspaces[0].nodes.push({
        ...structuredClone(s.workspaces[0].nodes[0]),
        id,
        kind: 'agent',
        agent: { taskId: null },
      })
      s.workspaces[0].spaces[0].nodeIds.push(id)
    }
  })
  const surface = createControlSurface()
  registerNodeControlHandlers(surface, {
    topology: {} as Parameters<typeof registerNodeControlHandlers>[1]['topology'],
    getPersistenceStore: async () => f.store as unknown as PersistenceStore,
  })
  const base = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const { grant } = new SessionGrantRegistry(() => true).issue(
    { projectId: 'project', spaceId: 'space', nodeId: 'self', sessionId: 'session' },
    now,
  )
  const invoke = (id: string, payload: unknown, user = false, assertActive?: () => void) =>
    surface.invoke(
      {
        ...base,
        assertActive,
        ...(user ? {} : { requestAuth: { kind: 'session-grant' as const, grant } }),
      },
      { kind: 'command', id, payload },
    )
  return { ...f, rows, invoke }
}

it.each(['self', 'child', 'grandchild', 'sibling', 'unrelated'])(
  'grant claim/release matrix: %s',
  async agentNodeId => {
    const f = setup(),
      allowed = ['self', 'child', 'grandchild'].includes(agentNodeId)
    const claimed = await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId })
    expect(claimed).toMatchObject(
      allowed
        ? { ok: true }
        : {
            ok: false,
            error: { code: 'common.forbidden', details: { reason: 'agent_identity_mismatch' } },
          },
    )
    if (!allowed) {
      expect(f.write).not.toHaveBeenCalled()
      expect(await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId }, true)).toMatchObject(
        { ok: true },
      )
    }
    f.write.mockClear()
    expect(await f.invoke('task.release', { taskNodeId: 'task', status: 'ai_done' })).toMatchObject(
      allowed
        ? { ok: true }
        : {
            ok: false,
            error: {
              code: 'common.forbidden',
              details: { reason: 'not_current_holder', holder: { nodeId: agentNodeId } },
            },
          },
    )
    if (allowed) {
      expect(f.state().workspaces[0].nodes.find(n => n.id === agentNodeId)?.agent).toMatchObject({
        taskId: null,
      })
    } else {
      expect(f.write).not.toHaveBeenCalled()
    }
  },
)
it('uses recorded ancestry through a deleted intermediate node, never snapshot lineage', async () => {
  const f = setup()
  f.advance(s => {
    s.workspaces[0].nodes = s.workspaces[0].nodes.filter(n => n.id !== 'child')
  })
  expect(
    await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'grandchild' }),
  ).toMatchObject({ ok: true })
  await f.invoke('task.release', { taskNodeId: 'task' })
  f.advance(s => {
    s.workspaces[0].nodes.find(n => n.id === 'unrelated')!.agent = {
      taskId: 'task',
      spawnedBy: 'self',
      rootNodeId: 'self',
    }
  })
  expect(
    await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'unrelated' }),
  ).toMatchObject({ ok: false, error: { code: 'common.forbidden' } })
})
it.each(['unavailable', 'cycle', 'failure'])(
  'fails closed for descendant lineage %s',
  async scenario => {
    const f = setup()
    if (scenario === 'unavailable') {
      f.store.nodeLineage = undefined
    }
    if (scenario === 'cycle') {
      f.rows.set('child', {
        nodeId: 'child',
        spawnedBy: 'grandchild',
        rootNodeId: 'root',
        lineageDepth: 3,
      })
    }
    if (scenario === 'failure') {
      vi.mocked(f.store.nodeLineage!.readMany).mockRejectedValue(new Error('storage failed'))
    }
    expect(
      await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'grandchild' }),
    ).toMatchObject({
      ok: false,
      error: {
        code: scenario === 'cycle' ? 'persistence.invalid_state' : 'persistence.unavailable',
      },
    })
    expect(f.write).not.toHaveBeenCalled()
  },
)
it('checks revocation after asynchronous lineage lookup', async () => {
  const f = setup()
  let revoked = false
  const read = f.store.nodeLineage!.readMany
  f.store.nodeLineage!.readMany = async ids => {
    const result = await read(ids)
    revoked = true
    return result
  }
  expect(
    await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'child' }, false, () => {
      if (revoked) {
        throw new Error('revoked')
      }
    }),
  ).toMatchObject({ ok: false })
  expect(f.write).not.toHaveBeenCalled()
})
it('revalidates holder and project after a conflicting delegated release', async () => {
  const f = setup()
  expect(await f.invoke('task.claim', { taskNodeId: 'task', agentNodeId: 'child' })).toMatchObject({
    ok: true,
  })
  const write = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async (state, options) => {
    f.advance(s => {
      s.workspaces[0].nodes[0].task = {
        ...(s.workspaces[0].nodes[0].task as object),
        linkedAgentNodeId: 'sibling',
      }
    })
    return write(state, options)
  })
  expect(await f.invoke('task.release', { taskNodeId: 'task' })).toMatchObject({
    ok: false,
    error: { code: 'common.forbidden', details: { holder: { nodeId: 'sibling' } } },
  })
})
