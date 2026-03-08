import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('creates a backup when migrating an existing db file', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

    tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
    const dbPath = join(tempDir, 'cove.db')
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
    const backupFiles = files.filter(name => name.startsWith('cove.db.bak-'))
    expect(backupFiles).toHaveLength(1)

    const backupContent = await readFile(join(tempDir, backupFiles[0] as string), 'utf8')
    expect(backupContent).toBe('legacy-db')
  })

  it('renames the db file when sqlite open fails (corruption recovery)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

    tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
    const dbPath = join(tempDir, 'cove.db')
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
    expect(files).toContain('cove.db.corrupt-2026-02-28T00-00-00-000Z')
    expect(await readFile(join(tempDir, 'cove.db.corrupt-2026-02-28T00-00-00-000Z'), 'utf8')).toBe(
      'corrupt-db',
    )
  })
})
