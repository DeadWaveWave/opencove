import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

type SqliteStatementLike = {
  all: (...params: unknown[]) => unknown[]
  get: (...params: unknown[]) => unknown
  run: (...params: unknown[]) => unknown
}

type SqliteDbLike = {
  close: () => void
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatementLike
  pragma: (query: string, options?: { simple?: boolean }) => unknown
}

async function openWritableSqliteDb(dbPath: string): Promise<SqliteDbLike> {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const BetterSqlite3 = require('better-sqlite3') as new (filePath: string) => SqliteDbLike
  return new BetterSqlite3(dbPath)
}

async function useActualBetterSqliteForModuleImports(): Promise<void> {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const BetterSqlite3 = require('better-sqlite3') as new (filePath: string) => SqliteDbLike
  vi.doMock('better-sqlite3', () => ({ default: BetterSqlite3 }))
}

function seedVersion2Schema(db: SqliteDbLike, options: { userVersion?: number } = {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      worktrees_root TEXT NOT NULL,
      viewport_x REAL NOT NULL,
      viewport_y REAL NOT NULL,
      viewport_zoom REAL NOT NULL,
      is_minimap_visible INTEGER NOT NULL,
      active_space_id TEXT
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_pinned_by_user INTEGER NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT,
      started_at TEXT,
      ended_at TEXT,
      exit_code INTEGER,
      last_error TEXT,
      execution_directory TEXT,
      expected_directory TEXT,
      agent_json TEXT,
      task_json TEXT
    );

    CREATE TABLE IF NOT EXISTS workspace_spaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      directory_path TEXT NOT NULL,
      rect_x REAL,
      rect_y REAL,
      rect_width REAL,
      rect_height REAL
    );

    CREATE TABLE IF NOT EXISTS workspace_space_nodes (
      space_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (space_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS node_scrollback (
      node_id TEXT PRIMARY KEY,
      scrollback TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  db.prepare(`INSERT INTO app_settings (id, value) VALUES (1, '{}')`).run()
  db.prepare(
    `
      INSERT INTO workspaces (
        id, name, path, worktrees_root,
        viewport_x, viewport_y, viewport_zoom,
        is_minimap_visible, active_space_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run('ws-1', 'Workspace', '/tmp/workspace', '/tmp', 1, 2, 1, 0, null)
  db.prepare(
    `
      INSERT INTO nodes (
        id, workspace_id, title, title_pinned_by_user,
        position_x, position_y, width, height,
        kind, status, started_at, ended_at, exit_code, last_error,
        execution_directory, expected_directory, agent_json, task_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    'node-1',
    'ws-1',
    'Node',
    0,
    10,
    20,
    300,
    200,
    'task',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  )
  db.prepare(
    `
      INSERT INTO workspace_spaces (
        id, workspace_id, name, directory_path, rect_x, rect_y, rect_width, rect_height
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run('space-1', 'ws-1', 'Space', '/tmp/workspace', 0, 0, 100, 100)
  db.prepare(
    `
      INSERT INTO workspace_space_nodes (space_id, node_id, sort_order)
      VALUES (?, ?, ?)
    `,
  ).run('space-1', 'node-1', 0)

  db.pragma(`user_version = ${options.userVersion ?? 2}`)
}

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
      await useActualBetterSqliteForModuleImports()
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

  it(
    'applies cumulative migrations when upgrading a version 2 db',
    async () => {
      await useActualBetterSqliteForModuleImports()
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')

      const seededDb = await openWritableSqliteDb(dbPath)
      seedVersion2Schema(seededDb)
      seededDb.close()

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()

      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: 'ws-1',
        workspaces: [
          {
            id: 'ws-1',
            name: 'Workspace',
            path: '/tmp/workspace',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            viewport: { x: 1, y: 2, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: 'space-1',
            nodes: [
              {
                id: 'node-1',
                title: 'Node',
                titlePinnedByUser: false,
                position: { x: 10, y: 20 },
                width: 300,
                height: 200,
                kind: 'task',
                labelColorOverride: 'blue',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: null,
                executionDirectory: null,
                expectedDirectory: null,
                task: null,
                agent: null,
                scrollback: null,
              },
            ],
            spaces: [
              {
                id: 'space-1',
                name: 'Space',
                directoryPath: '/tmp/workspace',
                labelColor: 'green',
                rect: { x: 0, y: 0, width: 100, height: 100 },
                nodeIds: ['node-1'],
              },
            ],
          },
        ],
        settings: {},
      })
      expect(result).toMatchObject({ ok: true, level: 'full' })
      store.dispose()

      const migratedDb = await openWritableSqliteDb(dbPath)
      expect(migratedDb.pragma('user_version', { simple: true })).toBe(4)
      expect(
        migratedDb
          .prepare(`PRAGMA table_info("nodes")`)
          .all()
          .map(row => (row as { name?: string }).name),
      ).toContain('label_color_override')
      expect(
        migratedDb
          .prepare(`PRAGMA table_info("workspace_spaces")`)
          .all()
          .map(row => (row as { name?: string }).name),
      ).toContain('label_color')
      expect(
        migratedDb
          .prepare(`PRAGMA table_info("workspaces")`)
          .all()
          .map(row => (row as { name?: string }).name),
      ).toContain('pull_request_base_branch_options_json')
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM nodes').get()).toEqual({ count: 1 })
      migratedDb.close()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'repairs a schema marked current when additive columns are missing',
    async () => {
      await useActualBetterSqliteForModuleImports()
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')

      const seededDb = await openWritableSqliteDb(dbPath)
      seedVersion2Schema(seededDb, { userVersion: 4 })
      seededDb.close()

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()
      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: {},
      })
      expect(result).toMatchObject({ ok: true, level: 'full' })
      store.dispose()

      const repairedDb = await openWritableSqliteDb(dbPath)
      expect(
        repairedDb
          .prepare(`PRAGMA table_info("nodes")`)
          .all()
          .map(row => (row as { name?: string }).name),
      ).toContain('label_color_override')
      expect(
        repairedDb
          .prepare(`PRAGMA table_info("workspace_spaces")`)
          .all()
          .map(row => (row as { name?: string }).name),
      ).toContain('label_color')
      repairedDb.close()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
