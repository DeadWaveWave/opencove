// @vitest-environment node
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { migrate } from '@platform/persistence/sqlite/migrate'
import { DB_SCHEMA_VERSION } from '@platform/persistence/sqlite/constants'
import { createPersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import {
  activateTaskAuthority,
  createTaskAuthorityRepository,
} from '@platform/persistence/sqlite/taskAuthorityStore'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { writeNormalizedAppState } from '@platform/persistence/sqlite/write'
import { taskAuthorityState } from './taskAuthorityFixtures'

const open: Database.Database[] = []
let root: string | undefined
const ids = { uuid: randomUUID, now: () => '2026-11-12T00:00:00.000Z' }
afterEach(async () => {
  for (const db of open.splice(0)) {
    db.close()
  }
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})
function fixture() {
  const db = new Database(':memory:')
  open.push(db)
  migrate(db)
  return db
}

describeWithElectronNativeModules('task authority adoption and downgrade', () => {
  it.each([
    ['todo', null, 'todo', false],
    ['doing', null, 'todo', false],
    ['doing', 'missing', 'todo', false],
    ['todo', 'a', 'doing', true],
    ['doing', 'a', 'doing', true],
    ['ai_done', 'a', 'ai_done', false],
    ['done', 'a', 'done', false],
    ['done', 'missing', 'done', false],
  ] as const)(
    'adopts status=%s link=%s conservatively',
    (status, link, expectedStatus, claimed) => {
      const db = fixture()
      const state = taskAuthorityState()
      Object.assign(state.workspaces[0].nodes[0].task!, { status, linkedAgentNodeId: link })
      writeNormalizedAppState(db, normalizePersistedAppState(state)!)
      const revision = activateTaskAuthority(db, ids)
      const record = createTaskAuthorityRepository(db).transaction(tx => tx.read('task')!)
      expect(record.status).toBe(expectedStatus)
      expect(!!record.claim).toBe(claimed)
      expect(activateTaskAuthority(db, ids)).toBe(revision)
      expect(createTaskAuthorityRepository(db).transaction(tx => tx.read('task')!)).toEqual(record)
    },
  )
  it('preserves duplicate link history as explicit resolvable conflicts without a fabricated lease', () => {
    const db = fixture()
    const state = taskAuthorityState()
    for (const node of state.workspaces[0].nodes.filter(n => n.kind === 'task')) {
      Object.assign(node.task!, { status: 'doing', linkedAgentNodeId: 'a' })
    }
    writeNormalizedAppState(db, normalizePersistedAppState(state)!)
    activateTaskAuthority(db, ids)
    const records = createTaskAuthorityRepository(db).transaction(tx =>
      tx.list().filter(r => r.kind === 'task'),
    )
    expect(records).toHaveLength(2)
    for (const record of records) {
      expect(record).toMatchObject({
        claim: null,
        linkedAgentNodeId: 'a',
        legacyConflict: { holderNodeId: 'a', taskNodeIds: ['other-task', 'task'] },
      })
    }
  })
  it('preserves oversized Unicode text exactly and does not adopt archive ownership', () => {
    const db = fixture()
    const state = taskAuthorityState()
    const text = ' 🌊\n'.repeat(300000)
    state.workspaces[0].nodes[2].task!.text = text
    const normalized = normalizePersistedAppState(state)!
    normalized.workspaces[0].spaceArchiveRecords = [
      {
        id: 'archive',
        nodes: [{ id: 'archived', kind: 'task', task: { claim: { leaseId: 'forged' } } }],
      },
    ]
    writeNormalizedAppState(db, normalized)
    activateTaskAuthority(db, ids)
    const repo = createTaskAuthorityRepository(db)
    expect(repo.transaction(tx => tx.read('note')!.text)).toBe(text)
    expect(repo.transaction(tx => tx.read('archived'))).toBeNull()
  })
  it.each([false, true])(
    'does not move aside or repair a newer database (strictRecovery=%s)',
    async strictRecovery => {
      root = await mkdtemp(join(tmpdir(), 'opencove-task-downgrade-'))
      const dbPath = join(root, 'state.db')
      const db = new Database(dbPath)
      open.push(db)
      db.exec(
        `CREATE TABLE future_only (value TEXT); INSERT INTO future_only VALUES ('preserve'); PRAGMA user_version = ${DB_SCHEMA_VERSION + 1}`,
      )
      await expect(createPersistenceStore({ dbPath, strictRecovery })).rejects.toThrow(
        'requires a newer OpenCove version',
      )
      expect(db.pragma('user_version', { simple: true })).toBe(DB_SCHEMA_VERSION + 1)
      expect(db.prepare('SELECT * FROM future_only').all()).toEqual([{ value: 'preserve' }])
      expect(await readdir(root)).toEqual(['state.db'])
    },
  )
})

describeWithElectronNativeModules('legacy terminal holder adoption', () => {
  it('retains an unverified terminal link as a conflict without trusting old runtime observations', () => {
    const db = fixture()
    const state = taskAuthorityState()
    state.workspaces[0].nodes.find(n => n.id === 'a')!.kind = 'terminal'
    Object.assign(state.workspaces[0].nodes[0].task!, { status: 'doing', linkedAgentNodeId: 'a' })
    writeNormalizedAppState(db, normalizePersistedAppState(state)!)
    activateTaskAuthority(db, ids)
    expect(createTaskAuthorityRepository(db).transaction(tx => tx.read('task'))).toMatchObject({
      claim: null,
      linkedAgentNodeId: 'a',
      legacyConflict: { holderNodeId: 'a', reason: 'unverified_holder' },
    })
  })
})
