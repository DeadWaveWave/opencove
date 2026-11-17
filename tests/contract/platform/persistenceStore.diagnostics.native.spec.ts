// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

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
        // Hold a real write lock until the store returns. Its deferred transaction reads
        // first, so SQLite rejects the read-to-write upgrade immediately with SQLITE_BUSY;
        // the store's default 5 s busy timeout does not need an override or a timed release.
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
