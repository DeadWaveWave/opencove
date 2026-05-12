import {
  integer,
  real,
  sqliteTable,
  text,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export type DbAppMetaKey = 'format_version' | 'active_workspace_id' | 'app_state_revision'

export const appMeta = sqliteTable('app_meta', {
  key: text('key').$type<DbAppMetaKey>().primaryKey(),
  value: text('value').notNull(),
})

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  value: text('value').notNull(),
})

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  worktreesRoot: text('worktrees_root').notNull(),
  pullRequestBaseBranchOptionsJson: text('pull_request_base_branch_options_json').notNull(),
  environmentVariablesJson: text('environment_variables_json').notNull(),
  spaceArchiveRecordsJson: text('space_archive_records_json').notNull(),
  viewportX: real('viewport_x').notNull(),
  viewportY: real('viewport_y').notNull(),
  viewportZoom: real('viewport_zoom').notNull(),
  isMinimapVisible: integer('is_minimap_visible', { mode: 'boolean' }).notNull(),
  activeSpaceId: text('active_space_id'),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sessionId: text('session_id'),
  title: text('title').notNull(),
  titlePinnedByUser: integer('title_pinned_by_user', { mode: 'number' }).notNull(),
  positionX: real('position_x').notNull(),
  positionY: real('position_y').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  kind: text('kind').notNull(),
  profileId: text('profile_id'),
  runtimeKind: text('runtime_kind'),
  terminalGeometryJson: text('terminal_geometry_json'),
  terminalProviderHint: text('terminal_provider_hint'),
  labelColorOverride: text('label_color_override'),
  status: text('status'),
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  exitCode: integer('exit_code'),
  lastError: text('last_error'),
  executionDirectory: text('execution_directory'),
  expectedDirectory: text('expected_directory'),
  agentJson: text('agent_json'),
  taskJson: text('task_json'),
})

export const spaces = sqliteTable('workspace_spaces', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  directoryPath: text('directory_path').notNull(),
  targetMountId: text('target_mount_id'),
  parentSpaceId: text('parent_space_id'),
  boundaryJson: text('boundary_json').notNull().default('{}'),
  sortOrder: integer('sort_order').notNull().default(0),
  labelColor: text('label_color'),
  rectX: real('rect_x'),
  rectY: real('rect_y'),
  rectWidth: real('rect_width'),
  rectHeight: real('rect_height'),
})

export const spaceNodes = sqliteTable(
  'workspace_space_nodes',
  {
    spaceId: text('space_id').notNull(),
    nodeId: text('node_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.spaceId, table.nodeId] }),
  }),
)

export const nodeScrollback = sqliteTable('node_scrollback', {
  nodeId: text('node_id').primaryKey(),
  scrollback: text('scrollback').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentNodePlaceholderScrollback = sqliteTable('agent_node_placeholder_scrollback', {
  nodeId: text('node_id').primaryKey(),
  scrollback: text('scrollback').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const browserProfileSettings = sqliteTable('browser_profile_settings', {
  profileKey: text('profile_key').primaryKey(),
  homepageUrl: text('homepage_url'),
  updatedAt: text('updated_at').notNull(),
})

export const browserHistory = sqliteTable(
  'browser_history',
  {
    id: text('id').primaryKey(),
    profileKey: text('profile_key').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    faviconUrl: text('favicon_url'),
    visitCount: integer('visit_count').notNull(),
    lastVisitedAt: text('last_visited_at').notNull(),
  },
  table => ({
    profileVisitedIdx: index('browser_history_profile_visited_idx').on(
      table.profileKey,
      table.lastVisitedAt,
    ),
    profileUrlIdx: uniqueIndex('browser_history_profile_url_unique_idx').on(
      table.profileKey,
      table.url,
    ),
  }),
)

export const browserBookmarks = sqliteTable(
  'browser_bookmarks',
  {
    id: text('id').primaryKey(),
    profileKey: text('profile_key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    faviconUrl: text('favicon_url'),
    folderId: text('folder_id'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => ({
    profileUpdatedIdx: index('browser_bookmarks_profile_updated_idx').on(
      table.profileKey,
      table.updatedAt,
    ),
    profileUrlIdx: uniqueIndex('browser_bookmarks_profile_url_unique_idx').on(
      table.profileKey,
      table.url,
    ),
  }),
)

export const browserDownloads = sqliteTable(
  'browser_downloads',
  {
    id: text('id').primaryKey(),
    profileKey: text('profile_key').notNull(),
    url: text('url').notNull(),
    filename: text('filename').notNull(),
    savePath: text('save_path'),
    state: text('state').notNull(),
    receivedBytes: integer('received_bytes').notNull(),
    totalBytes: integer('total_bytes'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    error: text('error'),
  },
  table => ({
    profileStartedIdx: index('browser_downloads_profile_started_idx').on(
      table.profileKey,
      table.startedAt,
    ),
  }),
)

export const browserPermissionDecisions = sqliteTable(
  'browser_permission_decisions',
  {
    id: text('id').primaryKey(),
    profileKey: text('profile_key').notNull(),
    origin: text('origin').notNull(),
    permission: text('permission').notNull(),
    decision: text('decision').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => ({
    profileOriginPermissionIdx: uniqueIndex(
      'browser_permissions_profile_origin_permission_unique_idx',
    ).on(table.profileKey, table.origin, table.permission),
  }),
)
