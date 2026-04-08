import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

type MockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  workspaceRows: Array<{ id: string; sortOrder: number }>
  legacyWorkspaceStateRaw?: string
  openAttempts: number
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

function createMockDbState(
  options: {
    userVersion?: number
    version2Schema?: boolean
    workspaceRows?: Array<{
      id: string
      sortOrder?: number
    }>
    legacyWorkspaceStateRaw?: string
  } = {},
): MockDbState {
  return {
    userVersion: options.userVersion ?? 0,
    tables: options.version2Schema
      ? new Map<string, string[]>([
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
      : new Map<string, string[]>(),
    workspaceRows: (options.workspaceRows ?? []).map(row => ({
      id: row.id,
      sortOrder: row.sortOrder ?? 0,
    })),
    ...(typeof options.legacyWorkspaceStateRaw === 'string'
      ? { legacyWorkspaceStateRaw: options.legacyWorkspaceStateRaw }
      : {}),
    openAttempts: 0,
  }
}

function createMockDatabaseModule(mockDbByPath: Map<string, MockDbState>) {
  return class MockDatabase {
    private readonly state: MockDbState

    public constructor(private readonly path: string) {
      const existing = mockDbByPath.get(path)
      if (!existing) {
        throw new Error(`Missing mock database state for ${path}`)
      }

      existing.openAttempts += 1
      this.state = existing
    }

    public pragma(query: string, options?: { simple?: boolean }): unknown {
      if (query === 'user_version' && options?.simple === true) {
        return this.state.userVersion
      }

      const match = query.match(/^user_version\s*=\s*(\d+)$/)
      if (match) {
        this.state.userVersion = Number(match[1])
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
        return {
          all: () => [],
          get: () => ({
            cnt: this.state.workspaceRows.filter(row => row.sortOrder !== 0).length,
          }),
          run: () => undefined,
        }
      }

      if (sql === 'SELECT id FROM workspaces ORDER BY rowid') {
        return {
          all: () => this.state.workspaceRows.map(row => ({ id: row.id })),
          get: () => undefined,
          run: () => undefined,
        }
      }

      if (sql === 'UPDATE workspaces SET sort_order = ? WHERE id = ?') {
        return {
          all: () => [],
          get: () => undefined,
          run: (...params: unknown[]) => {
            const [sortOrder, id] = params
            if (typeof sortOrder !== 'number' || typeof id !== 'string') {
              throw new Error('Invalid workspace sort_order backfill parameters')
            }

            const row = this.state.workspaceRows.find(workspaceRow => workspaceRow.id === id)
            if (!row) {
              throw new Error(`Unknown workspace row: ${id}`)
            }

            row.sortOrder = sortOrder
          },
        }
      }

      if (sql.includes('SELECT value FROM kv WHERE key = ?')) {
        return {
          all: () => [],
          get: () =>
            typeof this.state.legacyWorkspaceStateRaw === 'string'
              ? { value: this.state.legacyWorkspaceStateRaw }
              : undefined,
          run: () => undefined,
        }
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

describe('PersistenceStore sort order migration', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    if (!tempDir) {
      return
    }

    await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it(
    'repairs the workspaces schema and backfills sort_order in legacy rowid order',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-sort-order-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          createMockDbState({
            userVersion: 6,
            version2Schema: true,
            workspaceRows: [
              { id: 'ws-2', sortOrder: 0 },
              { id: 'ws-4', sortOrder: 0 },
              { id: 'ws-1', sortOrder: 0 },
            ],
          }),
        ],
      ])

      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()
      store.dispose()

      expect(mockDbByPath.get(dbPath)?.tables.get('workspaces')).toContain('sort_order')
      expect(mockDbByPath.get(dbPath)?.workspaceRows).toEqual([
        { id: 'ws-2', sortOrder: 0 },
        { id: 'ws-4', sortOrder: 1 },
        { id: 'ws-1', sortOrder: 2 },
      ])
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'does not backfill workspace sort_order when the column already exists',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-sort-order-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          createMockDbState({
            userVersion: 6,
            workspaceRows: [
              { id: 'ws-2', sortOrder: 0 },
              { id: 'ws-4', sortOrder: 0 },
              { id: 'ws-1', sortOrder: 0 },
            ],
          }),
        ],
      ])

      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()
      store.dispose()

      expect(mockDbByPath.get(dbPath)?.workspaceRows).toEqual([
        { id: 'ws-2', sortOrder: 0 },
        { id: 'ws-4', sortOrder: 0 },
        { id: 'ws-1', sortOrder: 0 },
      ])
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'backfills workspace sort_order after migrating legacy v1 kv state',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-sort-order-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          createMockDbState({
            userVersion: 1,
            legacyWorkspaceStateRaw: JSON.stringify({
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
                  id: 'ws-4',
                  name: 'Workspace 4',
                  path: '/tmp/ws-4',
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
            }),
          }),
        ],
      ])

      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()
      store.dispose()

      expect(mockDbByPath.get(dbPath)?.userVersion).toBe(7)
      expect(mockDbByPath.get(dbPath)?.workspaceRows).toEqual([
        { id: 'ws-2', sortOrder: 0 },
        { id: 'ws-4', sortOrder: 1 },
        { id: 'ws-1', sortOrder: 2 },
      ])
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
