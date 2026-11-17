// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

vi.mock('../../../src/platform/persistence/sqlite/migrate', async importOriginal => {
  const { migrate } =
    await importOriginal<typeof import('../../../src/platform/persistence/sqlite/migrate')>()
  return {
    migrate(db: Database.Database) {
      migrate(db)
      // Exercise a real busy-handler timeout without spending 5 s per diagnostic assertion.
      db.pragma('busy_timeout = 25')
    },
  }
})

describeWithElectronNativeModules('SQLite save diagnostics', () => {
  it.each(['raw', 'app'] as const)(
    'retains SQLITE_BUSY from a real locked %s write',
    async mode => {
      const root = await mkdtemp(join(process.cwd(), 'node_modules/persistence-lock-'))
      const dbPath = join(root, 'opencove.db')
      const store = await createPersistenceStore({ dbPath })
      const blocker = new Database(dbPath)
      const state = { formatVersion: 1, activeWorkspaceId: null, workspaces: [], settings: {} }
      try {
        // Hold the lock past this connection's test-only 25 ms busy timeout. A timed-out
        // BEGIN IMMEDIATE must retain the native SQLite error in the diagnostic result.
        blocker.exec('BEGIN EXCLUSIVE')
        const result =
          mode === 'raw'
            ? await store.writeWorkspaceStateRaw(JSON.stringify(state))
            : await store.writeAppState(state, { allowEmptyWorkspaceOverwrite: true })
        expect(result).toEqual({
          ok: false,
          reason: 'io',
          error: {
            code: 'persistence.io_failed',
            debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
          },
        })
        blocker.exec('ROLLBACK')
        expect(await store.writeAppState(state)).toMatchObject({ ok: true })
      } finally {
        if (blocker.inTransaction) {
          blocker.exec('ROLLBACK')
        }
        blocker.close()
        store.dispose()
        await rm(root, { recursive: true, force: true })
      }
    },
    15_000,
  )

  it('retains the name of a non-SQLite transaction error', async () => {
    const root = await mkdtemp(join(process.cwd(), 'node_modules/persistence-error-'))
    const store = await createPersistenceStore({ dbPath: join(root, 'opencove.db') })
    const prepare = vi.spyOn(Database.prototype, 'prepare').mockImplementation(() => {
      throw new TypeError('simulated transaction failure')
    })
    try {
      expect(
        await store.writeAppState(
          { formatVersion: 1, activeWorkspaceId: null, workspaces: [], settings: {} },
          { allowEmptyWorkspaceOverwrite: true },
        ),
      ).toMatchObject({
        ok: false,
        reason: 'io',
        error: {
          code: 'persistence.io_failed',
          debugMessage: 'TypeError: simulated transaction failure',
        },
      })
    } finally {
      prepare.mockRestore()
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
