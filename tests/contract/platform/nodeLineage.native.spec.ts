// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { createMinimalState } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { deriveNodeLineage } from '../../../src/contexts/workspace/domain/nodeLineage'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-lineage-'))
  const dbPath = join(root, 'opencove.db')
  const store = await createPersistenceStore({ dbPath })
  const state = createMinimalState(
    root,
    'project',
    'space',
  ) as unknown as import('../../../src/contexts/workspace/application/nodeControl/nodeControlState').NodeControlAppState
  const template = {
    sessionId: null,
    title: 'Node',
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: null,
    task: null,
    scrollback: null,
  }
  state.workspaces[0].nodes = ['parent', 'child'].map(id => ({ ...template, id, kind: 'terminal' }))
  state.workspaces[0].spaces[0].nodeIds = ['parent', 'child']
  const lineage = deriveNodeLineage({ nodeId: 'child', callerNodeId: 'parent', parent: null })
  return {
    root,
    dbPath,
    store,
    state,
    lineage,
    cleanup: async () => {
      store.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

describeWithElectronNativeModules('durable node lineage', () => {
  it('ignores forged lineage options on ordinary snapshot writes and keeps roots unrecorded', async () => {
    const f = await fixture()
    try {
      expect(await f.store.writeAppState(f.state, { expectedRevision: 0 })).toMatchObject({
        ok: true,
      })
      const options = { expectedRevision: 1, lineage: f.lineage }
      expect(await f.store.writeAppState(f.state, options)).toMatchObject({ ok: true })
      expect((await f.store.nodeLineage!.readMany(['parent', 'child'])).size).toBe(0)
      expect(await f.store.writeWorkspaceStateRaw(JSON.stringify(f.state))).toMatchObject({
        ok: true,
      })
      expect((await f.store.nodeLineage!.readMany(['parent', 'child'])).size).toBe(0)
    } finally {
      await f.cleanup()
    }
  })
  it('survives stale CAS, structured/raw snapshots, forged fields, deletion and a cold reopen', async () => {
    const f = await fixture()
    try {
      expect(
        await f.store.commitCreatedNodeState!(f.state, { expectedRevision: 0, lineage: f.lineage }),
      ).toMatchObject({ ok: true, revision: 1 })
      const stale = structuredClone(f.state)
      stale.settings = { marker: 'stale' }
      expect(await f.store.writeAppState(stale, { expectedRevision: 0 })).toMatchObject({
        ok: false,
      })
      // A publication from an old renderer has no lineage; a newer malicious renderer cannot inject it.
      const forged = structuredClone(f.state)
      Object.assign(forged.workspaces[0].nodes[1], {
        spawnedBy: 'forged',
        lineageDepth: 99,
        rootNodeId: 'forged',
      })
      expect(await f.store.writeAppState(forged, { expectedRevision: 1 })).toMatchObject({
        ok: true,
      })
      forged.workspaces[0].spaces[0].nodeIds = ['child']
      forged.workspaces[0].nodes = []
      expect(await f.store.writeWorkspaceStateRaw(JSON.stringify(forged))).toMatchObject({
        ok: true,
      })
      expect((await f.store.nodeLineage!.readMany(['child'])).get('child')).toEqual(f.lineage)
      expect(await f.store.writeWorkspaceStateRaw(JSON.stringify(f.state))).toMatchObject({
        ok: true,
      })
      f.store.dispose()
      const reopened = await createPersistenceStore({ dbPath: f.dbPath })
      try {
        expect((await reopened.nodeLineage!.readMany(['child'])).get('child')).toEqual(f.lineage)
        const descendant = deriveNodeLineage({
          nodeId: 'grandchild',
          callerNodeId: 'child',
          parent: (await reopened.nodeLineage!.readMany(['child'])).get('child')!,
        })
        expect(descendant.lineageDepth).toBe(3)
      } finally {
        reopened.dispose()
      }
    } finally {
      await f.cleanup()
    }
  })
  it('rolls back both node replacement and lineage on conflicting insert or stale revision', async () => {
    const f = await fixture()
    try {
      expect(
        await f.store.commitCreatedNodeState!(f.state, { expectedRevision: 0, lineage: f.lineage }),
      ).toMatchObject({ ok: true })
      const changed = { ...f.state, settings: { changed: true } }
      expect(
        await f.store.commitCreatedNodeState!(changed, {
          expectedRevision: 1,
          lineage: { ...f.lineage, spawnedBy: 'forged' },
        }),
      ).toMatchObject({ ok: false })
      expect(await f.store.readAppStateRevision()).toBe(1)
      expect(await f.store.readAppState()).not.toMatchObject({ settings: { changed: true } })
      const next = { ...f.lineage, nodeId: 'new' }
      expect(
        await f.store.commitCreatedNodeState!(changed, { expectedRevision: 0, lineage: next }),
      ).toMatchObject({ ok: false })
      expect((await f.store.nodeLineage!.readMany(['new'])).size).toBe(0)
      // An identical lineage repeat is idempotent.
      expect(
        await f.store.commitCreatedNodeState!(f.state, { expectedRevision: 1, lineage: f.lineage }),
      ).toMatchObject({ ok: true })
    } finally {
      await f.cleanup()
    }
  })
  it('rolls back node/lineage insertion failures injected on the real connection', async () => {
    const f = await fixture()
    const db = new Database(f.dbPath)
    try {
      db.exec(
        "CREATE TRIGGER reject_lineage BEFORE INSERT ON node_lineage BEGIN SELECT RAISE(ABORT, 'lineage failure'); END",
      )
      expect(
        await f.store.commitCreatedNodeState!(f.state, { expectedRevision: 0, lineage: f.lineage }),
      ).toMatchObject({ ok: false })
      expect(await f.store.readAppStateRevision()).toBe(0)
      expect((await f.store.nodeLineage!.readMany(['child'])).size).toBe(0)
      db.exec('DROP TRIGGER reject_lineage')
      db.exec(
        "CREATE TRIGGER reject_node BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'node failure'); END",
      )
      expect(
        await f.store.commitCreatedNodeState!(f.state, { expectedRevision: 0, lineage: f.lineage }),
      ).toMatchObject({ ok: false })
      expect(await f.store.readAppStateRevision()).toBe(0)
      expect((await f.store.nodeLineage!.readMany(['child'])).size).toBe(0)
    } finally {
      db.close()
      await f.cleanup()
    }
  })
  it.each([13, 14, DB_SCHEMA_VERSION])(
    'creates or repairs schema v%s without adopting existing nodes',
    async version => {
      const f = await fixture()
      try {
        await f.store.writeAppState(f.state)
        f.store.dispose()
        const db = new Database(f.dbPath)
        db.exec('DROP TABLE node_lineage')
        if (version < 14) {
          db.exec('DROP TABLE managed_claude_resume_bindings; DROP TABLE retired_managed_nodes')
        }
        db.pragma(`user_version = ${version}`)
        db.close()
        const repaired = await createPersistenceStore({ dbPath: f.dbPath })
        try {
          expect((await repaired.nodeLineage!.readMany(['parent', 'child'])).size).toBe(0)
          const inspect = new Database(f.dbPath)
          try {
            expect(inspect.pragma('user_version', { simple: true })).toBe(DB_SCHEMA_VERSION)
            expect(inspect.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual(
              [],
            )
            expect(inspect.prepare('SELECT * FROM retired_managed_nodes').all()).toEqual([])
            expect(inspect.pragma('foreign_key_list(node_lineage)')).toEqual([])
            expect(inspect.pragma('index_list(node_lineage)')).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ name: 'node_lineage_parent_idx' }),
                expect.objectContaining({ name: 'node_lineage_root_idx' }),
              ]),
            )
          } finally {
            inspect.close()
          }
          expect(
            await repaired.commitCreatedNodeState!(f.state, {
              expectedRevision: 1,
              lineage: f.lineage,
            }),
          ).toMatchObject({ ok: true })
          repaired.dispose()
          const missingIndex = new Database(f.dbPath)
          missingIndex.exec('DROP INDEX node_lineage_parent_idx')
          missingIndex.close()
          const indexed = await createPersistenceStore({ dbPath: f.dbPath })
          try {
            expect((await indexed.nodeLineage!.readMany(['child'])).get('child')).toEqual(f.lineage)
            const inspectIndex = new Database(f.dbPath)
            try {
              expect(inspectIndex.pragma('index_list(node_lineage)')).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({ name: 'node_lineage_parent_idx' }),
                ]),
              )
            } finally {
              inspectIndex.close()
            }
          } finally {
            indexed.dispose()
          }
        } finally {
          repaired.dispose()
        }
      } finally {
        await f.cleanup()
      }
    },
  )
})
