// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { migrate } from '../../../src/platform/persistence/sqlite/migrate'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'
import { stateWithAgent, tupleA } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude resume schema and orphan reclamation', () => {
  let root: string
  let sql: Database.Database
  let store: Awaited<ReturnType<typeof createPersistenceStore>> | undefined
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-resume-schema-'))
    sql = new Database(join(root, 'state.db'))
  })
  afterEach(async () => {
    sql?.close()
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const open = () =>
    createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
  function assertEmptyLedger() {
    expect(sql.pragma('user_version', { simple: true })).toBe(DB_SCHEMA_VERSION)
    for (const table of ['managed_claude_resume_bindings', 'retired_managed_nodes']) {
      expect(sql.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
      expect(sql.pragma(`foreign_key_list(${table})`)).toEqual([])
    }
  }
  it('creates the ledger before the v1 legacy writer and preserves its state', async () => {
    sql.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1')
    sql
      .prepare('INSERT INTO kv VALUES (?, ?)')
      .run('workspace-state-raw', JSON.stringify(stateWithAgent()))
    store = await open()
    assertEmptyLedger()
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ agent: tupleA }] }],
    })
    expect(await store.readAppStateRevision()).toBe(1)
  })
  it('upgrades a populated v13 profile without inferring ownership', async () => {
    migrate(sql)
    store = await open()
    await store.writeAppState(stateWithAgent())
    store.dispose()
    sql.exec(
      'DROP TABLE managed_claude_resume_bindings; DROP TABLE retired_managed_nodes; PRAGMA user_version = 13',
    )
    store = await open()
    assertEmptyLedger()
    expect(await store.readAppStateSnapshot()).toMatchObject({
      revision: 1,
      state: { workspaces: [{ nodes: [{ agent: tupleA }] }] },
    })
  })
  it('repairs missing current-schema structures without inventing rows', async () => {
    migrate(sql)
    sql.exec('DROP TABLE managed_claude_resume_bindings; DROP TABLE retired_managed_nodes')
    store = await open()
    assertEmptyLedger()
    store.dispose()
    store = await open()
    assertEmptyLedger()
  })
  it('reclaims only old unseen absent rows at open and preserves first-seen rows across restart', async () => {
    store = await open()
    const activate = (nodeId: string) =>
      store!.activateManagedClaudeRuntime({
        nodeId,
        activationId: nodeId,
        runtimeSessionId: 'runtime',
        tuple: tupleA,
      })
    expect(await activate('agent')).toEqual({ status: 'committed' })
    expect(await store.readAppStateRevision()).toBe(0)
    await activate('old-orphan')
    await activate('young-orphan')
    await activate('boundary-orphan')
    await activate('seen-absent')
    await store.writeAppState(stateWithAgent())
    expect(
      sql
        .prepare('SELECT node_seen FROM managed_claude_resume_bindings WHERE node_id = ?')
        .get('agent'),
    ).toEqual({ node_seen: 1 })
    // Adversarial fixtures: even a stale unseen flag cannot make an existing node collectible.
    sql
      .prepare('UPDATE managed_claude_resume_bindings SET node_seen = 0 WHERE node_id = ?')
      .run('agent')
    sql
      .prepare('UPDATE managed_claude_resume_bindings SET node_seen = 1 WHERE node_id = ?')
      .run('seen-absent')
    sql
      .prepare(
        'UPDATE managed_claude_resume_bindings SET updated_at = 0 WHERE node_id != ? AND node_id != ?',
      )
      .run('young-orphan', 'boundary-orphan')
    sql
      .prepare('UPDATE managed_claude_resume_bindings SET updated_at = ? WHERE node_id = ?')
      .run(Date.now() - 23 * 60 * 60 * 1000, 'boundary-orphan')
    store.dispose()
    store = await open()
    expect(
      sql.prepare('SELECT node_id FROM managed_claude_resume_bindings ORDER BY node_id').all(),
    ).toEqual([
      { node_id: 'agent' },
      { node_id: 'boundary-orphan' },
      { node_id: 'seen-absent' },
      { node_id: 'young-orphan' },
    ])
    expect(await store.readAppStateRevision()).toBe(1)
    await store.writeAppState(stateWithAgent())
    store.dispose()
    store = await open()
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ sessionId: 'runtime', agent: tupleA }] }],
    })
  })
})
