import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

describe('PersistenceStore', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.useRealTimers()
    vi.resetModules()
    vi.clearAllMocks()

    if (!tempDir) {
      return
    }

    await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it(
    'creates a backup when migrating an existing db file',
    async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      await writeFile(dbPath, 'legacy-db')

      type MockDbState = { userVersion: number }
      const mockDbByPath = new Map<string, MockDbState>()

      class MockDatabase {
        private readonly state: MockDbState

        public constructor(private readonly path: string) {
          const existing = mockDbByPath.get(path)
          if (existing) {
            this.state = existing
            return
          }

          const next: MockDbState = { userVersion: 0 }
          mockDbByPath.set(path, next)
          this.state = next
        }

        public pragma(query: string, options?: { simple?: boolean }): unknown {
          if (query === 'user_version' && options?.simple === true) {
            return this.state.userVersion
          }

          const match = query.match(/^user_version\\s*=\\s*(\\d+)$/)
          if (match) {
            this.state.userVersion = Number(match[1])
            return undefined
          }

          return undefined
        }

        public exec(_sql: string): void {}

        public prepare(_sql: string): { run: () => void } {
          return { run: () => undefined }
        }

        public transaction<TArgs extends unknown[], TResult>(
          fn: (...args: TArgs) => TResult,
        ): (...args: TArgs) => TResult {
          return (...args: TArgs) => fn(...args)
        }

        public close(): void {}
      }

      vi.doMock('better-sqlite3', () => ({ default: MockDatabase }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      store.dispose()

      const files = await readdir(tempDir)
      const backupFiles = files.filter(name => name.startsWith('opencove.db.bak-'))
      expect(backupFiles).toHaveLength(1)

      const backupContent = await readFile(join(tempDir, backupFiles[0] as string), 'utf8')
      expect(backupContent).toBe('legacy-db')
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'renames the db file when sqlite open fails (corruption recovery)',
    async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      await writeFile(dbPath, 'corrupt-db')

      let openAttempts = 0

      class MockDatabase {
        public constructor() {
          openAttempts += 1
          if (openAttempts === 1) {
            throw new Error('SQLITE_CORRUPT: database disk image is malformed')
          }
        }

        public pragma(): unknown {
          return 0
        }

        public exec(): void {}

        public prepare(): { run: () => void } {
          return { run: () => undefined }
        }

        public transaction<TArgs extends unknown[], TResult>(
          fn: (...args: TArgs) => TResult,
        ): (...args: TArgs) => TResult {
          return (...args: TArgs) => fn(...args)
        }

        public close(): void {}
      }

      vi.doMock('better-sqlite3', () => ({ default: MockDatabase }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      store.dispose()

      const files = await readdir(tempDir)
      expect(files).toContain('opencove.db.corrupt-2026-02-28T00-00-00-000Z')
      expect(
        await readFile(join(tempDir, 'opencove.db.corrupt-2026-02-28T00-00-00-000Z'), 'utf8'),
      ).toBe('corrupt-db')
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'measures workspace state payload size in UTF-8 bytes',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const raw = JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: { label: '中😀' },
      })
      const rawBytes = Buffer.byteLength(raw, 'utf8')
      expect(rawBytes).toBeGreaterThan(raw.length)

      const oversizedStore = await createPersistenceStore({
        dbPath: join(tempDir, 'oversized.db'),
        maxRawBytes: raw.length,
      })
      const oversizedResult = await oversizedStore.writeWorkspaceStateRaw(raw)
      expect(oversizedResult).toEqual({
        ok: false,
        reason: 'payload_too_large',
        error: {
          code: 'persistence.payload_too_large',
          params: {
            bytes: rawBytes,
            maxBytes: raw.length,
          },
          debugMessage: `Workspace state payload too large to persist (${rawBytes} bytes).`,
        },
      })
      oversizedStore.dispose()

      const store = await createPersistenceStore({
        dbPath: join(tempDir, 'opencove.db'),
        maxRawBytes: rawBytes,
      })

      const result = await store.writeWorkspaceStateRaw(raw)
      expect(result).toEqual({ ok: true, level: 'full', bytes: rawBytes })
      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
