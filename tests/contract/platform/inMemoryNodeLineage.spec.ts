// @vitest-environment node
import { expect, it } from 'vitest'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { deriveNodeLineage } from '../../../src/contexts/workspace/domain/nodeLineage'

async function fixture() {
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState('/repo', 'project', 'space')
  const parent = { id: 'parent', kind: 'terminal', sessionId: 'session', title: 'Parent' }
  state.workspaces[0].nodes = [parent]
  await store.writeAppState(state)
  const next = structuredClone(state)
  next.workspaces[0].nodes.push({ ...parent, id: 'child', title: 'Child' })
  const lineage = deriveNodeLineage({ nodeId: 'child', callerNodeId: 'parent', parent: null })
  return { store, state, next, lineage }
}

it('atomically publishes node state and immutable lineage in the shared memory fixture', async () => {
  const { store, next, lineage } = await fixture()
  expect(store.commitCreatedNodeState).toBeTypeOf('function')
  expect(store.nodeLineage).toBeDefined()
  expect(await store.commitCreatedNodeState!(next, { expectedRevision: 1, lineage })).toMatchObject(
    {
      ok: true,
      revision: 2,
    },
  )
  const rows = await store.nodeLineage!.readMany(['child'])
  expect(rows.get('child')).toEqual(lineage)
  rows.get('child')!.spawnedBy = 'forged'
  expect((await store.nodeLineage!.readMany(['child'])).get('child')).toEqual(lineage)
  expect((await store.nodeLineage!.readMany(['parent'])).size).toBe(0)
})

it('keeps state, revision and lineage unchanged on stale CAS or conflicting ancestry', async () => {
  const { store, state, next, lineage } = await fixture()
  expect(await store.commitCreatedNodeState!(next, { expectedRevision: 0, lineage })).toMatchObject(
    { ok: false },
  )
  expect(await store.readAppState()).toEqual(state)
  expect(await store.readAppStateRevision()).toBe(1)
  expect((await store.nodeLineage!.readMany(['child'])).size).toBe(0)
  await store.commitCreatedNodeState!(next, { expectedRevision: 1, lineage })
  const changed = { ...next, settings: { marker: 'rejected' } }
  expect(
    await store.commitCreatedNodeState!(changed, {
      expectedRevision: 2,
      lineage: { ...lineage, spawnedBy: 'forged' },
    }),
  ).toMatchObject({ ok: false })
  expect(await store.readAppState()).toEqual(next)
  expect(await store.readAppStateRevision()).toBe(2)
  expect((await store.nodeLineage!.readMany(['child'])).get('child')).toEqual(lineage)
})

it('does not let snapshot options insert lineage or deletion erase it', async () => {
  const { store, state, next, lineage } = await fixture()
  const options = { expectedRevision: 1, lineage }
  expect(await store.writeAppState(next, options)).toMatchObject({ ok: true })
  expect((await store.nodeLineage!.readMany(['child'])).size).toBe(0)
  await store.commitCreatedNodeState!(next, { expectedRevision: 2, lineage })
  expect(await store.writeAppState(state)).toMatchObject({ ok: true })
  expect((await store.nodeLineage!.readMany(['child'])).get('child')).toEqual(lineage)
})
