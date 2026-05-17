import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertCurrentSchemaColumns,
  assertInstalledUpgradeCoverageMatchesCurrentSchemaVersion,
  createInstalledUpgradeState,
  SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS,
  type MockDbState,
} from './persistenceInstalledUpgradeSupport'
import { CURRENT_SCHEMA_COLUMNS } from './persistenceSchemaColumns'

const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

function createMockDatabaseModule(mockDbByPath: Map<string, MockDbState>) {
  return class MockDatabase {
    private readonly state: MockDbState

    public constructor(private readonly path: string) {
      const existing = mockDbByPath.get(path)
      if (!existing) {
        throw new Error(`Missing mock database state for ${path}`)
      }

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
          all: () => (this.state.tables.get(tableName) ?? []).map(name => ({ name })),
          get: () => undefined,
          run: () => undefined,
        }
      }

      if (sql === 'SELECT value FROM kv WHERE key = ?') {
        return {
          all: () => [],
          get: () => ({ value: JSON.stringify(createLegacyWorkspaceState()) }),
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
            const row = this.state.workspaceRows.find(candidate => candidate.id === id)
            if (typeof sortOrder === 'number' && row) {
              row.sortOrder = sortOrder
            }
          },
        }
      }

      return { all: () => [], get: () => undefined, run: () => undefined }
    }

    public transaction<TArgs extends unknown[], TResult>(
      fn: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      return (...args: TArgs) => fn(...args)
    }

    public select(): unknown {
      const state = this.state
      return {
        from(table: Record<symbol, unknown>) {
          const tableName = String(table[Symbol.for('drizzle:Name')] ?? '')
          return {
            all: () => {
              if (tableName === 'app_meta') {
                return state.appMetaRows
              }
              if (tableName === 'nodes' || tableName === 'workspace_space_nodes') {
                return []
              }
              if (tableName === 'workspace_spaces') {
                return state.spaceRecords.map(space => ({
                  targetMountId: null,
                  parentSpaceId: null,
                  boundaryJson: '{}',
                  sortOrder: 0,
                  labelColor: null,
                  ...space,
                }))
              }
              return []
            },
            orderBy: () => ({
              all: () =>
                state.workspaceRecords.map(workspace => ({
                  pullRequestBaseBranchOptionsJson: '[]',
                  environmentVariablesJson: '{}',
                  spaceArchiveRecordsJson: '[]',
                  sortOrder: 0,
                  ...workspace,
                })),
            }),
            where: () => ({
              get: () => ({ value: state.appSettingsValue }),
            }),
          }
        },
      }
    }

    public close(): void {}
  }
}

function createLegacyWorkspaceState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'ws-installed',
    workspaces: [
      {
        id: 'ws-installed',
        name: 'Installed Workspace v1',
        path: 'D:\\Projects\\Installed',
        worktreesRoot: 'D:\\Projects',
        viewport: { x: 10, y: 20, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: 'space-installed',
        nodes: [],
        spaces: [
          {
            id: 'space-installed',
            name: 'Main Space',
            directoryPath: 'D:\\Projects\\Installed',
            nodeIds: [],
            rect: { x: 1, y: 2, width: 300, height: 200 },
          },
        ],
      },
    ],
    settings: {},
  }
}

describe('PersistenceStore installed upgrade', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('keeps installed upgrade coverage aligned with DB_SCHEMA_VERSION', () => {
    assertInstalledUpgradeCoverageMatchesCurrentSchemaVersion()
  })

  it.each(SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS)(
    'reads an installed v%s project after upgrading to the current schema',
    async sourceVersion => {
      tempDir = await mkdtemp(join(tmpdir(), 'opencove-installed-upgrade-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [dbPath, createInstalledUpgradeState(sourceVersion)],
      ])
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))
      vi.doMock('drizzle-orm/better-sqlite3', () => ({
        drizzle: (sqlite: unknown) => sqlite,
      }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      expect(store.consumeRecovery()).toBeNull()

      const state = await store.readAppState()
      store.dispose()

      assertCurrentSchemaColumns(mockDbByPath.get(dbPath))
      expect(state).toMatchObject({
        activeWorkspaceId: 'ws-installed',
        workspaces: [
          {
            id: 'ws-installed',
            activeSpaceId: 'space-installed',
            spaces: [
              {
                id: 'space-installed',
                parentSpaceId: null,
                boundary: {
                  allowedMountIds: [],
                  scopesByMountId: {},
                  allowedPluginIds: null,
                  capabilities: null,
                  trustLevel: null,
                },
                sortOrder: 0,
              },
            ],
          },
        ],
      })
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
