// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import {
  createPersistenceStore,
  type PersistenceStore,
} from '@platform/persistence/sqlite/PersistenceStore'
import { migrate } from '@platform/persistence/sqlite/migrate'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { writeNormalizedAppState } from '@platform/persistence/sqlite/write'
import { taskAuthorityState } from './taskAuthorityFixtures'
import { openSchema15ManagedWorker } from '../../support/persistenceSchema15Worker'

let root: string | undefined
const stores: PersistenceStore[] = []
const sql: Database.Database[] = []
afterEach(async () => {
  stores.splice(0).forEach(s => s.dispose())
  sql.splice(0).forEach(db => db.close())
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})
describeWithElectronNativeModules('dormant task schema compatibility', () => {
  it.each([false, true])(
    'reopens an ordinary installation in the frozen schema 15 managed Worker (strictRecovery=%s)',
    async strictRecovery => {
      root = await mkdtemp(join(tmpdir(), 'opencove-task-compat-'))
      const dbPath = join(root, 'state.db')
      const db = new Database(dbPath)
      sql.push(db)
      migrate(db)
      writeNormalizedAppState(db, normalizePersistedAppState(taskAuthorityState())!)
      // Installed previous-Worker shape: no V5 tables and a literal schema 15 marker.
      db.exec(
        'DROP TABLE task_claim_holders; DROP TABLE task_command_receipts; DROP TABLE task_field_authority; PRAGMA user_version = 15',
      )
      const before = openSchema15ManagedWorker(dbPath)
      expect(before.read('note').text).toBe('Original 🌊')
      before.close()
      const current = await createPersistenceStore({ dbPath, strictRecovery })
      stores.push(current)
      const revision = await current.readAppStateRevision()
      current.dispose()
      const old = openSchema15ManagedWorker(dbPath)
      try {
        expect(old.read('note').text).toBe('Original 🌊')
        old.edit('note', { text: 'Edited by the previous Worker 🌊' })
        old.edit('task', { status: 'done' })
      } finally {
        old.close()
      }
      const reopened = await createPersistenceStore({ dbPath, strictRecovery: true })
      stores.push(reopened)
      expect(await reopened.readAppStateRevision()).toBe(revision + 2)
      expect(await reopened.readAppState()).toMatchObject({
        workspaces: [
          {
            nodes: expect.arrayContaining([
              expect.objectContaining({
                id: 'note',
                task: expect.objectContaining({ text: 'Edited by the previous Worker 🌊' }),
              }),
              expect.objectContaining({
                id: 'task',
                task: expect.objectContaining({ status: 'done' }),
              }),
            ]),
          },
        ],
      })
      expect(db.pragma('user_version', { simple: true })).toBe(15)
      for (const table of ['task_field_authority', 'task_command_receipts', 'task_claim_holders']) {
        expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
      }
      expect(
        db.prepare("SELECT value FROM app_meta WHERE key = 'task_authority_active'").get(),
      ).toBeUndefined()
    },
  )
  it('keeps the frozen previous Worker refusal for a genuinely newer schema', async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-task-old-worker-'))
    const dbPath = join(root, 'state.db')
    const db = new Database(dbPath)
    sql.push(db)
    db.pragma('user_version = 16')
    expect(() => openSchema15ManagedWorker(dbPath)).toThrow('cannot downgrade')
  })
})
