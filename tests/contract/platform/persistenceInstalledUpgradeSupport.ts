import { expect } from 'vitest'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'
import { CURRENT_SCHEMA_COLUMNS } from './persistenceSchemaColumns'

export const SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export type InstalledUpgradeSourceVersion =
  (typeof SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS)[number]

export type WorkspaceRecord = {
  id: string
  name: string
  path: string
  worktreesRoot: string
  viewportX: number
  viewportY: number
  viewportZoom: number
  isMinimapVisible: boolean
  activeSpaceId: string | null
}

export type SpaceRecord = {
  id: string
  workspaceId: string
  name: string
  directoryPath: string
  rectX: number | null
  rectY: number | null
  rectWidth: number | null
  rectHeight: number | null
}

export type MockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  appMetaRows: Array<{ key: string; value: string }>
  appSettingsValue: string
  workspaceRows: Array<{ id: string; sortOrder: number }>
  workspaceRecords: WorkspaceRecord[]
  spaceRecords: SpaceRecord[]
}

type SchemaPreset = 'legacy-kv' | 'v2-core' | 'v5-mounted' | 'v8-installed'

const COLUMNS_ADDED_AFTER_VERSION: Record<number, Record<string, string[]>> = {
  2: {
    workspaces: [
      'pull_request_base_branch_options_json',
      'environment_variables_json',
      'space_archive_records_json',
      'sort_order',
    ],
    nodes: [
      'session_id',
      'profile_id',
      'runtime_kind',
      'terminal_geometry_json',
      'terminal_provider_hint',
      'label_color_override',
    ],
    workspace_spaces: ['target_mount_id', 'parent_space_id', 'boundary_json', 'sort_order'],
  },
  3: {
    workspaces: ['environment_variables_json', 'space_archive_records_json', 'sort_order'],
    nodes: ['profile_id', 'runtime_kind', 'terminal_geometry_json', 'terminal_provider_hint'],
    workspace_spaces: ['target_mount_id', 'parent_space_id', 'boundary_json', 'sort_order'],
  },
  4: {
    workspaces: ['environment_variables_json', 'space_archive_records_json', 'sort_order'],
    nodes: ['terminal_geometry_json', 'terminal_provider_hint'],
    workspace_spaces: ['target_mount_id', 'parent_space_id', 'boundary_json', 'sort_order'],
  },
  5: {
    workspaces: ['environment_variables_json', 'space_archive_records_json', 'sort_order'],
    nodes: ['terminal_geometry_json', 'terminal_provider_hint'],
    workspace_spaces: ['parent_space_id', 'boundary_json', 'sort_order'],
  },
  6: {
    workspaces: ['environment_variables_json', 'space_archive_records_json', 'sort_order'],
    workspace_spaces: ['parent_space_id', 'boundary_json', 'sort_order'],
  },
  7: {
    workspaces: ['environment_variables_json', 'space_archive_records_json', 'sort_order'],
    workspace_spaces: ['parent_space_id', 'boundary_json', 'sort_order'],
  },
  8: {
    workspaces: ['environment_variables_json'],
    workspace_spaces: ['parent_space_id', 'boundary_json', 'sort_order'],
  },
}

function currentTablesWithout(omissions: Record<string, string[]>): Map<string, string[]> {
  return new Map(
    Object.entries(CURRENT_SCHEMA_COLUMNS).map(([tableName, columns]) => [
      tableName,
      [...columns].filter(column => !(omissions[tableName] ?? []).includes(column)),
    ]),
  )
}

function createV2CoreTables(): Map<string, string[]> {
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

function resolveSchemaPreset(version: InstalledUpgradeSourceVersion): SchemaPreset {
  if (version === 1) {
    return 'legacy-kv'
  }

  if (version >= 2 && version <= 4) {
    return 'v2-core'
  }

  if (version >= 5 && version <= 7) {
    return 'v5-mounted'
  }

  return 'v8-installed'
}

function createTablesForVersion(version: InstalledUpgradeSourceVersion): Map<string, string[]> {
  const preset = resolveSchemaPreset(version)
  if (preset === 'legacy-kv') {
    return new Map<string, string[]>([['kv', ['key', 'value']]])
  }

  if (preset === 'v2-core') {
    return createV2CoreTables()
  }

  return currentTablesWithout(COLUMNS_ADDED_AFTER_VERSION[version] ?? {})
}

export function assertInstalledUpgradeCoverageMatchesCurrentSchemaVersion(): void {
  const expected = Array.from({ length: DB_SCHEMA_VERSION - 1 }, (_, index) => index + 1)
  expect(SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS).toEqual(expected)
}

export function createInstalledUpgradeState(version: InstalledUpgradeSourceVersion): MockDbState {
  return {
    userVersion: version,
    tables: createTablesForVersion(version),
    appMetaRows: [
      { key: 'format_version', value: '1' },
      { key: 'active_workspace_id', value: 'ws-installed' },
      { key: 'app_state_revision', value: '1' },
    ],
    appSettingsValue: '{}',
    workspaceRows: [{ id: 'ws-installed', sortOrder: 0 }],
    workspaceRecords: [
      {
        id: 'ws-installed',
        name: `Installed Workspace v${version}`,
        path: 'D:\\Projects\\Installed',
        worktreesRoot: 'D:\\Projects',
        viewportX: 10,
        viewportY: 20,
        viewportZoom: 1,
        isMinimapVisible: true,
        activeSpaceId: 'space-installed',
      },
    ],
    spaceRecords: [
      {
        id: 'space-installed',
        workspaceId: 'ws-installed',
        name: 'Main Space',
        directoryPath: 'D:\\Projects\\Installed',
        rectX: 1,
        rectY: 2,
        rectWidth: 300,
        rectHeight: 200,
      },
    ],
  }
}

export function assertCurrentSchemaColumns(state: MockDbState | undefined): void {
  expect(state?.userVersion).toBe(DB_SCHEMA_VERSION)
  for (const [tableName, columns] of Object.entries(CURRENT_SCHEMA_COLUMNS)) {
    expect(state?.tables.get(tableName)).toEqual(expect.arrayContaining([...columns]))
  }
}
