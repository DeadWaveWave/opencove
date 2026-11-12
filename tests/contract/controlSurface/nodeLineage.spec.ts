// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  prepareNodeLineage,
  projectNodeLineages,
  resolveCallerParent,
} from '../../../src/contexts/workspace/application/nodeLineage/NodeLineageOwner'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createMinimalState } from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import {
  nodeCreateOperation,
  nodeResolveCallerSelectorOperation,
} from '../../../src/shared/contracts/controlSurface/operations/domains/node'
import type { NodeLineageRecord } from '../../../src/contexts/workspace/domain/nodeLineage'

function fixture() {
  const state = createMinimalState('/repo', 'project', 'space')
  const template = { ...state.workspaces[0].nodes[0], kind: 'terminal' }
  state.workspaces[0].nodes = ['parent', 'child'].map(id => ({ ...template, id }))
  const rows = new Map<string, NodeLineageRecord>([
    ['child', { nodeId: 'child', spawnedBy: 'parent', rootNodeId: 'parent', lineageDepth: 2 }],
  ])
  const store = {
    readAppState: async () => state,
    nodeLineage: { readMany: vi.fn(async () => rows) },
    commitCreatedNodeState: vi.fn(),
  } as unknown as NodeControlAppStateStore
  return { state, rows, store }
}
it('resolves a terminal parent, ignores movement and preserves ancestry after parent deletion', async () => {
  const { state, store, rows } = fixture()
  expect(await resolveCallerParent(store, 'child', { selector: '@parent' })).toEqual({
    kind: 'node',
    id: 'parent',
    callerNodeId: 'child',
  })
  state.workspaces[0].spaces[0].nodeIds = ['child']
  const record = structuredClone(rows.get('child'))
  state.workspaces[0].nodes = state.workspaces[0].nodes.filter(n => n.id !== 'parent')
  await expect(resolveCallerParent(store, 'child', { selector: '@parent' })).rejects.toMatchObject({
    code: 'node.parent_unavailable',
    details: { reason: 'parent_deleted' },
  })
  expect(rows.get('child')).toEqual(record)
})
it('uses authenticated caller identity and rejects missing or mismatched identities without writes', async () => {
  const { store } = fixture()
  await expect(resolveCallerParent(store, null, { selector: '@parent' })).rejects.toMatchObject({
    details: { reason: 'caller_identity_required' },
  })
  await expect(
    resolveCallerParent(store, 'child', { selector: '@parent', expectedCallerNodeId: 'parent' }),
  ).rejects.toMatchObject({ code: 'common.forbidden' })
  await expect(resolveCallerParent(store, 'parent', { selector: '@parent' })).rejects.toMatchObject(
    { details: { reason: 'no_parent' } },
  )
  await expect(
    resolveCallerParent(store, 'deleted', { selector: '@parent' }),
  ).rejects.toMatchObject({ code: 'node.not_found' })
  expect(store.commitCreatedNodeState).not.toHaveBeenCalled()
})
it('records any caller kind, increments stored depth and leaves bearer/standalone nodes as roots', async () => {
  const { store } = fixture()
  expect(await prepareNodeLineage(store, 'next', 'child')).toMatchObject({
    spawnedBy: 'child',
    lineageDepth: 3,
    rootNodeId: 'parent',
  })
  expect(await prepareNodeLineage(store, 'next', 'parent')).toMatchObject({
    spawnedBy: 'parent',
    lineageDepth: 2,
  })
  expect(await prepareNodeLineage(store, 'next', null)).toBeNull()
})
it('projects roots and direct children, failing explicitly when filtered authority is unreadable', async () => {
  const { store } = fixture()
  expect(await projectNodeLineages(store, [{ id: 'parent' }, { id: 'child' }], 'parent')).toEqual([
    { id: 'child', spawnedBy: 'parent', lineageDepth: 2, lineageStatus: 'recorded' },
  ])
  expect(await projectNodeLineages(store, [{ id: 'parent' }])).toMatchObject([
    { lineageStatus: 'root', lineageDepth: 1 },
  ])
  store.nodeLineage!.readMany = async () => {
    throw Error('unreadable')
  }
  expect(await projectNodeLineages(store, [{ id: 'child' }])).toMatchObject([
    { lineageStatus: 'unavailable', lineageDepth: null },
  ])
  await expect(projectNodeLineages(store, [{ id: 'child' }], 'parent')).rejects.toMatchObject({
    code: 'persistence.unavailable',
  })
})
it('publishes strict selector schemas and rejects forged creation lineage', () => {
  expect(
    nodeResolveCallerSelectorOperation.input.safeParse({
      selector: '@parent',
      expectedCallerNodeId: 'child',
    }).success,
  ).toBe(true)
  expect(
    nodeResolveCallerSelectorOperation.input.safeParse({ selector: '@parent', nodeId: 'forged' })
      .success,
  ).toBe(false)
  for (const key of [
    'spawnedBy',
    'lineageDepth',
    'rootNodeId',
    'humanApproved',
    'admissionHandle',
  ]) {
    expect(nodeCreateOperation.input.safeParse({ kind: 'note', [key]: 'forged' }).success).toBe(
      false,
    )
  }
})

it('attributes legacy note.create without changing defaults and leaves standalone grants unrecorded', async () => {
  const { createControlSurface } =
    await import('../../../src/app/main/controlSurface/controlSurface')
  const { registerSyncHandlers } =
    await import('../../../src/app/main/controlSurface/handlers/syncHandlers')
  const { createInMemoryPersistenceStore } =
    await import('./controlSurfaceHttpServer.sessionStreaming.testUtils')
  const { SessionGrantRegistry } =
    await import('../../../src/app/main/controlSurface/http/sessionGrantRegistry')
  const f = fixture()
  const store = createInMemoryPersistenceStore()
  const records = new Map<string, NodeLineageRecord>()
  store.nodeLineage = { readMany: async () => records }
  store.commitCreatedNodeState = async (state, options) => {
    const result = await store.writeAppState(state, options)
    if (result.ok) {
      records.set(options.lineage.nodeId, options.lineage)
    }
    return result
  }
  await store.writeAppState(f.state)
  const surface = createControlSurface()
  registerSyncHandlers(surface, async () => store)
  const grants = new SessionGrantRegistry(() => true)
  const grant = grants.issue({
    projectId: 'project',
    spaceId: 'space',
    nodeId: 'parent',
    sessionId: 'session',
  }).grant
  const result = await surface.invoke(
    { now: () => new Date(), requestAuth: { kind: 'session-grant', grant } },
    { kind: 'command', id: 'note.create', payload: { spaceId: 'space' } },
  )
  expect(result.ok).toBe(true)
  const created = result.ok ? (result.value as { nodeId: string }) : null
  expect(records.get(created!.nodeId)).toMatchObject({ spawnedBy: 'parent', lineageDepth: 2 })
  expect(await store.readAppState()).toMatchObject({
    workspaces: [
      {
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: created!.nodeId,
            title: 'Note',
            width: 360,
            height: 260,
            task: { text: '' },
          }),
        ]),
      },
    ],
  })
  const standalone = grants.issue({
    projectId: 'project',
    spaceId: 'space',
    nodeId: null,
    sessionId: 'standalone',
  }).grant
  const root = await surface.invoke(
    { now: () => new Date(), requestAuth: { kind: 'session-grant', grant: standalone } },
    { kind: 'command', id: 'note.create', payload: { spaceId: 'space' } },
  )
  expect(root.ok).toBe(true)
  expect(records.size).toBe(1)
})

it('refuses an unauthenticated parent selector before touching persistence', async () => {
  const { createControlSurface } =
    await import('../../../src/app/main/controlSurface/controlSurface')
  const { registerNodeControlHandlers } =
    await import('../../../src/app/main/controlSurface/handlers/nodeControlHandlers')
  const surface = createControlSurface()
  const getPersistenceStore = vi.fn(async () => {
    throw Error('not available')
  })
  registerNodeControlHandlers(surface, { topology: {} as never, getPersistenceStore })
  expect(
    await surface.invoke(
      { now: () => new Date(), requestAuth: { kind: 'bearer' } },
      { kind: 'query', id: 'node.resolveCallerSelector', payload: { selector: '@parent' } },
    ),
  ).toMatchObject({
    ok: false,
    error: { code: 'node.parent_unavailable', details: { reason: 'caller_identity_required' } },
  })
  expect(getPersistenceStore).not.toHaveBeenCalled()
})
