// @vitest-environment node
import { expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { createInMemoryPersistenceStore } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])('advertises lineage only with both read=%s and commit=%s authority', async (read, commit) => {
  const store = createInMemoryPersistenceStore()
  store.nodeLineage = read ? { readMany: async () => new Map() } : undefined
  store.commitCreatedNodeState = commit
    ? async () => ({ ok: true, level: 'full', bytes: 0 })
    : undefined
  const surface = createControlSurface()
  registerControlSurfaceHandlers(surface, {
    getPersistenceStore: async () => store,
    ptyRuntime: {},
    plugins: { configureHost() {} },
    ptyStreamHub: { agentRuns: { registry: { onDispose() {} } } },
  } as Parameters<typeof registerControlSurfaceHandlers>[1])
  expect(
    await surface.invoke(
      { now: () => new Date(), capabilities: {} },
      {
        kind: 'query',
        id: 'system.capabilities',
        payload: {},
      },
    ),
  ).toMatchObject({
    ok: true,
    value: { features: { operationRegistry: true, nodeLineageV1: read && commit } },
  })
})
