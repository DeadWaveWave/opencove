import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

type MockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  openAttempts: number
  workspaceRows: Array<{ id: string; sortOrder: number }>
  failOnFirstOpen?: boolean
}

const CURRENT_SCHEMA_COLUMNS = {
  app_meta: ['key', 'value'],
  app_settings: ['id', 'value'],
  workspaces: [
    'id',
    'name',
    'path',
    'worktrees_root',
    'pull_request_base_branch_options_json',
    'space_archive_records_json',
    'viewport_x',
    'viewport_y',
    'viewport_zoom',
    'is_minimap_visible',
    'active_space_id',
    'sort_order',
  ],
  nodes: [
    'id',
    'workspace_id',
    'session_id',
    'title',
    'title_pinned_by_user',
    'position_x',
    'position_y',
    'width',
    'height',
    'kind',
    'label_color_override',
    'status',
    'started_at',
    'ended_at',
    'exit_code',
    'last_error',
    'execution_directory',
    'expected_directory',
    'agent_json',
    'task_json',
  ],
  workspace_spaces: [
    'id',
    'workspace_id',
    'name',
    'directory_path',
    'label_color',
    'rect_x',
    'rect_y',
    'rect_width',
    'rect_height',
  ],
  workspace_space_nodes: ['space_id', 'node_id', 'sort_order'],
  node_scrollback: ['node_id', 'scrollback', 'updated_at'],
} as const

function createVersion2Tables(): Map<string, string[]> {
  return new Map<string, string[]>([
    ['app_meta', [...CURRENT_SCHEMA_COLUMNS.app_meta]],
    ['app_settings', [...CURRENT_SCHEMA_COLUMNS.app_settings]],
    [
      'workspaces',
      [
        'id',
        'name',
        'path',
        'worktrees_root',
        'viewport_x',
        'viewport_y',
        'viewport_zoom',
        'is_minimap_visible',
        'active_space_id',
      ],
    ],
    [
      'nodes',
      [
        'id',
        'workspace_id',
        'title',
        'title_pinned_by_user',
        'position_x',
        'position_y',
        'width',
        'height',
        'kind',
        'status',
        'started_at',
        'ended_at',
        'exit_code',
        'last_error',
        'execution_directory',
        'expected_directory',
        'agent_json',
        'task_json',
      ],
    ],
    [
      'workspace_spaces',
      [
        'id',
        'workspace_id',
        'name',
        'directory_path',
        'rect_x',
        'rect_y',
        'rect_width',
        'rect_height',
      ],
    ],
    ['workspace_space_nodes', [...CURRENT_SCHEMA_COLUMNS.workspace_space_nodes]],
    ['node_scrollback', [...CURRENT_SCHEMA_COLUMNS.node_scrollback]],
  ])
}

function createMockDbState(
  options: {
    userVersion?: number
    version2Schema?: boolean
    failOnFirstOpen?: boolean
  } = {},
): MockDbState {
  return {
    userVersion: options.userVersion ?? 0,
    tables: options.version2Schema ? createVersion2Tables() : new Map<string, string[]>(),
    openAttempts: 0,
    workspaceRows: [],
    ...(options.failOnFirstOpen ? { failOnFirstOpen: true } : {}),
  }
}

function createMockDatabaseModule(mockDbByPath: Map<string, MockDbState>) {
  return class MockDatabase {
    private readonly state: MockDbState

    public constructor(private readonly path: string) {
      const existing = mockDbByPath.get(path)
      const nextState = existing ?? createMockDbState()
      nextState.openAttempts += 1

      if (nextState.failOnFirstOpen === true && nextState.openAttempts === 1) {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed')
      }

      mockDbByPath.set(path, nextState)
      this.state = nextState
    }

    public pragma(query: string, options?: { simple?: boolean }): unknown {
      if (query === 'user_version' && options?.simple === true) {
        return this.state.userVersion
      }

      const match = query.match(/^user_version\s*=\s*(\d+)$/)
      if (match) {
        this.state.userVersion = Number(match[1])
        return undefined
      }

      return undefined
    }

    public exec(sql: string): void {
      for (const [tableName, columns] of Object.entries(CURRENT_SCHEMA_COLUMNS)) {
        if (
          sql.includes(`CREATE TABLE IF NOT EXISTS ${tableName}`) &&
          !this.state.tables.has(tableName)
        ) {
          this.state.tables.set(tableName, [...columns])
        }
      }

      const alterRegex =
        /ALTER TABLE\s+("?)([A-Za-z_][A-Za-z0-9_]*)\1\s+ADD COLUMN\s+("?)([A-Za-z_][A-Za-z0-9_]*)\3/gi
      for (const match of sql.matchAll(alterRegex)) {
        const tableName = match[2]
        const columnName = match[4]
        const existingColumns = this.state.tables.get(tableName) ?? []
        if (!existingColumns.includes(columnName)) {
          existingColumns.push(columnName)
          this.state.tables.set(tableName, existingColumns)
        }
      }

      const dropRegex = /DROP TABLE IF EXISTS\s+("?)([A-Za-z_][A-Za-z0-9_]*)\1/gi
      for (const match of sql.matchAll(dropRegex)) {
        this.state.tables.delete(match[2])
      }
    }

    public prepare(sql: string): {
      all: () => unknown[]
      get: (...params: unknown[]) => unknown
      run: (...params: unknown[]) => void
    } {
      const tableInfoMatch = sql.match(/PRAGMA table_info\("?([A-Za-z_][A-Za-z0-9_]*)"?\)/i)
      if (tableInfoMatch) {
        const tableName = tableInfoMatch[1]
        return {
          all: () =>
            (this.state.tables.get(tableName) ?? []).map(name => ({
              name,
            })),
          get: () => undefined,
          run: () => undefined,
        }
      }

      if (sql === 'SELECT COUNT(*) as cnt FROM workspaces WHERE sort_order != 0') {
        return { all: () => [], get: () => ({ cnt: 1 }), run: () => undefined }
      }

      const insertMatch = sql.match(
        /INSERT INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES/i,
      )
      if (insertMatch) {
        const tableName = insertMatch[1]
        const columns = insertMatch[2]
          .split(',')
          .map(column => column.replace(/\s+/g, ' ').trim())
          .filter(column => column.length > 0)
        return {
          all: () => [],
          get: () => undefined,
          run: (...params: unknown[]) => {
            const tableColumns = this.state.tables.get(tableName) ?? []
            for (const column of columns) {
              if (!tableColumns.includes(column)) {
                throw new Error(`table ${tableName} has no column named ${column}`)
              }
            }

            if (tableName !== 'workspaces') {
              return
            }

            const idIndex = columns.indexOf('id')
            if (idIndex < 0) {
              throw new Error('workspace insert missing id column')
            }

            const id = params[idIndex]
            if (typeof id !== 'string') {
              throw new Error('workspace insert missing id value')
            }

            const sortOrderIndex = columns.indexOf('sort_order')
            const sortOrderParam = sortOrderIndex >= 0 ? params[sortOrderIndex] : 0
            if (typeof sortOrderParam !== 'number') {
              throw new Error('workspace insert sort_order must be numeric')
            }

            this.state.workspaceRows.push({ id, sortOrder: sortOrderParam })
          },
        }
      }
      return {
        all: () => [],
        get: () => undefined,
        run: () => undefined,
      }
    }

    public transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args)
    }

    public close(): void {}
  }
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
    'writes workspace sort_order from the in-memory array order',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })

      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: 'ws-2',
        workspaces: [
          {
            id: 'ws-2',
            name: 'Workspace 2',
            path: '/tmp/ws-2',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            spaceArchiveRecords: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: null,
            nodes: [],
            spaces: [],
          },
          {
            id: 'ws-1',
            name: 'Workspace 1',
            path: '/tmp/ws-1',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            spaceArchiveRecords: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: null,
            nodes: [],
            spaces: [],
          },
        ],
        settings: {},
      })

      expect(result).toMatchObject({ ok: true, level: 'full' })
      expect(mockDbByPath.get(dbPath)?.workspaceRows).toEqual([
        { id: 'ws-2', sortOrder: 0 },
        { id: 'ws-1', sortOrder: 1 },
      ])

      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'creates a backup when migrating an existing db file',
    async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      await writeFile(dbPath, 'legacy-db')

      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

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

      const mockDbByPath = new Map<string, MockDbState>([
        [dbPath, createMockDbState({ failOnFirstOpen: true })],
      ])
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

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
      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

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
      expect(result).toMatchObject({ ok: true, level: 'full', bytes: rawBytes })
      if (result.ok) {
        expect(result.revision).toBeTypeOf('number')
        expect(result.revision).toBeGreaterThan(0)
      }
      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
