import {
  appMeta,
  appSettings,
  nodes,
  spaceNodes,
  spaces,
  workspaces,
} from '../../../src/platform/persistence/sqlite/schema'
import { CURRENT_SCHEMA_COLUMNS } from './persistenceSchemaColumns'

export const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

export type MockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  openAttempts: number
  workspaceRows: Array<{ id: string; sortOrder: number }>
  workspaceIconRows: Array<{ id: string; iconId: string | null }>
  nodeRows: Array<{ id: string; sidebarSortOrder: number | null }>
  currentState: unknown | null
  failOnFirstOpen?: boolean
}

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

export function createMockDbState(
  options: {
    userVersion?: number
    version2Schema?: boolean
    failOnFirstOpen?: boolean
    currentState?: unknown | null
  } = {},
): MockDbState {
  return {
    userVersion: options.userVersion ?? 0,
    tables: options.version2Schema ? createVersion2Tables() : new Map<string, string[]>(),
    openAttempts: 0,
    workspaceRows: [],
    workspaceIconRows: [],
    nodeRows: [],
    currentState: options.currentState ?? null,
    ...(options.failOnFirstOpen ? { failOnFirstOpen: true } : {}),
  }
}

export function createMockDatabaseModule(mockDbByPath: Map<string, MockDbState>) {
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

    public select(selection?: unknown) {
      return {
        from: (table: unknown) => {
          if (table === appMeta) {
            return {
              all: () => {
                const state = this.state.currentState
                if (!state || typeof state !== 'object' || Array.isArray(state)) {
                  return []
                }

                const record = state as Record<string, unknown>
                return [
                  { key: 'format_version', value: String(record.formatVersion ?? 1) },
                  {
                    key: 'active_workspace_id',
                    value:
                      typeof record.activeWorkspaceId === 'string' ? record.activeWorkspaceId : '',
                  },
                ]
              },
            }
          }

          if (table === appSettings) {
            return {
              where: () => ({
                get: () => {
                  const state = this.state.currentState
                  if (!state || typeof state !== 'object' || Array.isArray(state)) {
                    return undefined
                  }

                  return selection
                    ? { value: JSON.stringify((state as Record<string, unknown>).settings ?? {}) }
                    : {
                        id: 1,
                        value: JSON.stringify((state as Record<string, unknown>).settings ?? {}),
                      }
                },
              }),
            }
          }

          if (table === workspaces) {
            return {
              all: () => {
                const state = this.state.currentState
                if (!state || typeof state !== 'object' || Array.isArray(state)) {
                  return []
                }

                const record = state as Record<string, unknown>
                const workspacesRaw = Array.isArray(record.workspaces) ? record.workspaces : []
                return workspacesRaw.map((workspace, index) => {
                  const candidate = workspace as Record<string, unknown>
                  return {
                    id: typeof candidate.id === 'string' ? candidate.id : `workspace-${index}`,
                    name: typeof candidate.name === 'string' ? candidate.name : '',
                    iconId: typeof candidate.iconId === 'string' ? candidate.iconId : null,
                    path: typeof candidate.path === 'string' ? candidate.path : '',
                    worktreesRoot:
                      typeof candidate.worktreesRoot === 'string' ? candidate.worktreesRoot : '',
                    pullRequestBaseBranchOptionsJson: JSON.stringify(
                      Array.isArray(candidate.pullRequestBaseBranchOptions)
                        ? candidate.pullRequestBaseBranchOptions
                        : [],
                    ),
                    environmentVariablesJson: JSON.stringify(
                      candidate.environmentVariables &&
                        typeof candidate.environmentVariables === 'object' &&
                        !Array.isArray(candidate.environmentVariables)
                        ? candidate.environmentVariables
                        : {},
                    ),
                    spaceArchiveRecordsJson: JSON.stringify(
                      Array.isArray(candidate.spaceArchiveRecords)
                        ? candidate.spaceArchiveRecords
                        : [],
                    ),
                    viewportX:
                      candidate.viewport &&
                      typeof (candidate.viewport as Record<string, unknown>).x === 'number'
                        ? ((candidate.viewport as Record<string, unknown>).x as number)
                        : 0,
                    viewportY:
                      candidate.viewport &&
                      typeof (candidate.viewport as Record<string, unknown>).y === 'number'
                        ? ((candidate.viewport as Record<string, unknown>).y as number)
                        : 0,
                    viewportZoom:
                      candidate.viewport &&
                      typeof (candidate.viewport as Record<string, unknown>).zoom === 'number'
                        ? ((candidate.viewport as Record<string, unknown>).zoom as number)
                        : 1,
                    isMinimapVisible: candidate.isMinimapVisible !== false,
                    activeSpaceId:
                      typeof candidate.activeSpaceId === 'string' ? candidate.activeSpaceId : null,
                    sortOrder: index,
                  }
                })
              },
              limit: () => ({
                get: () => {
                  const rows = this.select(selection).from(workspaces).all() as Array<{
                    id: string
                  }>
                  return rows[0] ?? undefined
                },
              }),
            }
          }

          if (table === nodes || table === spaces || table === spaceNodes) {
            return {
              all: () => [],
            }
          }

          throw new Error('Unexpected table')
        },
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

      if (sql.includes('FROM app_meta') && sql.includes("WHERE key = 'app_state_revision'")) {
        return {
          all: () => [],
          get: () => ({ value: '1' }),
          run: () => undefined,
        }
      }

      if (sql === 'SELECT 1 FROM workspaces LIMIT 1') {
        return {
          all: () => [],
          get: () =>
            this.state.workspaceRows.length > 0 ||
            (Array.isArray(
              (this.state.currentState as Record<string, unknown> | null)?.workspaces,
            ) &&
              ((this.state.currentState as Record<string, unknown>).workspaces as unknown[])
                .length > 0)
              ? { 1: 1 }
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

            if (tableName === 'nodes') {
              const idIndex = columns.indexOf('id')
              if (idIndex < 0) {
                throw new Error('node insert missing id column')
              }

              const id = params[idIndex]
              if (typeof id !== 'string') {
                throw new Error('node insert missing id value')
              }

              const sidebarSortOrderIndex = columns.indexOf('sidebar_sort_order')
              const sidebarSortOrderParam =
                sidebarSortOrderIndex >= 0 ? params[sidebarSortOrderIndex] : null
              if (sidebarSortOrderParam !== null && typeof sidebarSortOrderParam !== 'number') {
                throw new Error('node insert sidebar_sort_order must be numeric or null')
              }

              this.state.nodeRows.push({
                id,
                sidebarSortOrder: sidebarSortOrderParam,
              })
              return
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

            const iconIdIndex = columns.indexOf('icon_id')
            const iconIdParam = iconIdIndex >= 0 ? params[iconIdIndex] : null
            if (iconIdParam !== null && typeof iconIdParam !== 'string') {
              throw new Error('workspace insert icon_id must be text or null')
            }

            this.state.workspaceIconRows.push({ id, iconId: iconIdParam })
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
