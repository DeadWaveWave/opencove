// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMockDatabaseModule, createMockDbState } from './persistenceStoreTestSupport'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'

let root = ''
afterEach(async () => {
  vi.restoreAllMocks()
  vi.doUnmock('better-sqlite3')
  vi.doUnmock('drizzle-orm/better-sqlite3')
  vi.resetModules()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

it('ignores extra lineage options on snapshots while preserving the dedicated creation entry point', async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-lineage-boundary-'))
  const dbPath = join(root, 'opencove.db')
  const database = createMockDatabaseModule(
    new Map([[dbPath, createMockDbState({ userVersion: DB_SCHEMA_VERSION })]]),
  )
  vi.doMock('better-sqlite3', () => ({ default: database }))
  vi.doMock('drizzle-orm/better-sqlite3', () => ({ drizzle: (sqlite: unknown) => sqlite }))
  const repository =
    await import('../../../src/contexts/workspace/infrastructure/nodeLineage/SqliteNodeLineageRepository')
  const insert = vi.spyOn(repository, 'insertNodeLineage')
  const { createPersistenceStore } =
    await import('../../../src/platform/persistence/sqlite/PersistenceStore')
  const store = await createPersistenceStore({ dbPath })
  const state = {
    formatVersion: 1,
    workspaces: [{ id: 'project', path: root, nodes: [{ id: 'root', kind: 'note' }] }],
    settings: {},
  }
  // A variable can carry extra properties through TypeScript's structural typing.
  const options = {
    expectedRevision: 0,
    lineage: { nodeId: 'root', spawnedBy: 'forged', rootNodeId: 'forged', lineageDepth: 2 },
  }
  try {
    expect(await store.writeAppState(state, options)).toMatchObject({ ok: true })
    expect(insert).not.toHaveBeenCalled()
    expect(await store.commitCreatedNodeState!(state, options)).toMatchObject({ ok: true })
    expect(insert).toHaveBeenCalledExactlyOnceWith(expect.anything(), options.lineage)
  } finally {
    store.dispose()
  }
})
