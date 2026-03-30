import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

type MockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  workspaceRows: Array<{
    id: string
    sortOrder: number
  }>
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
    'does not backfill workspace sort_order when the column already exists',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-sort-order-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          {
            userVersion: 5,
            tables: new Map<string, string[]>([['workspaces', [...CURRENT_SCHEMA_COLUMNS.workspaces]]]),
            workspaceRows: [
              { id: 'ws-2', sortOrder: 0 },
              { id: 'ws-4', sortOrder: 0 },
              { id: 'ws-1', sortOrder: 0 },
            ],
            openAttempts: 0,
          },
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
})
