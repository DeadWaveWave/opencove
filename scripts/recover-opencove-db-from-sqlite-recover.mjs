#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const DEFAULT_SQLITE3_BIN = process.env.OPENCOVE_SQLITE3_BIN ?? process.env.SQLITE3_BIN ?? 'sqlite3'
// Keep in sync with src/platform/persistence/sqlite/constants.ts.
const DB_SCHEMA_VERSION = 9
const PERSISTED_APP_STATE_FORMAT_VERSION = 1

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeArg(raw) {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

function printUsage() {
  process.stdout.write(`Usage:
  pnpm recover:opencove-db -- --recover-sql /path/to/recover.sql --source-db /path/to/opencove.db --output-db /path/to/rebuilt.db [options]
  pnpm recover:opencove-db -- /path/to/recover.sql /path/to/opencove.db /path/to/rebuilt.db

Required inputs:
  --recover-sql        sqlite3 .recover output file for the damaged database
  --source-db          original database used to preserve app settings and browser data
  --output-db          rebuilt database path

Workspace selection:
  --workspace-id       exact workspace id to restore as active
  --workspace-name     workspace name to match
  --workspace-path     workspace path to match

Other options:
  --sqlite3-bin        sqlite3 executable to use (default: ${DEFAULT_SQLITE3_BIN})
  -h, --help           show this help

Typical recovery flow:
  sqlite3 /path/to/opencove.db ".recover" > /path/to/recover.sql
  pnpm recover:opencove-db -- \\
    --recover-sql /path/to/recover.sql \\
    --source-db /path/to/opencove.db \\
    --output-db /path/to/opencove-rebuilt.db \\
    --workspace-name cove \\
    --workspace-path /path/to/workspace
`)
}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      'recover-sql': { type: 'string' },
      'source-db': { type: 'string' },
      'output-db': { type: 'string' },
      'workspace-id': { type: 'string' },
      'workspace-name': { type: 'string' },
      'workspace-path': { type: 'string' },
      'sqlite3-bin': { type: 'string' },
    },
    allowPositionals: true,
  })

  return { values, positionals }
}

function sqliteLiteral(value) {
  if (value === null || value === undefined) {
    return 'NULL'
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 'NULL'
    }

    return Number.isInteger(value) ? String(value) : String(value)
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }

  return `'${String(value).replaceAll("'", "''")}'`
}

function sqliteReadCommand(filePath) {
  return `.read ${JSON.stringify(filePath)}`
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value) {
  const parsed = parseNumber(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function parseBooleanInteger(value) {
  const parsed = parseInteger(value)
  return parsed === null ? 0 : parsed === 0 ? 0 : 1
}

function parseNullableString(value) {
  return typeof value === 'string' ? value : null
}

function coalesceString(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function scoreCompleteness(record) {
  return Object.values(record).reduce((count, value) => {
    if (value === null || value === undefined) {
      return count
    }

    if (typeof value === 'string') {
      return value.length > 0 ? count + 1 : count
    }

    return count + 1
  }, 0)
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
  )
}

function isAbsolutePathLike(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/u.test(value))
  )
}

function parseInsertValues(line) {
  const start = line.indexOf('VALUES(')
  const end = line.lastIndexOf(');')
  if (start < 0 || end < 0 || end <= start) {
    return null
  }

  const source = line.slice(start + 7, end)
  const values = []
  let index = 0

  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index])) {
      index += 1
    }

    if (index >= source.length) {
      break
    }

    if (source[index] === ',') {
      index += 1
      continue
    }

    if (source[index] === "'") {
      index += 1
      let value = ''

      while (index < source.length) {
        const current = source[index]
        if (current === "'") {
          if (source[index + 1] === "'") {
            value += "'"
            index += 2
            continue
          }

          index += 1
          break
        }

        value += current
        index += 1
      }

      values.push(value)
      continue
    }

    let cursor = index
    while (cursor < source.length && source[cursor] !== ',') {
      cursor += 1
    }

    const raw = source.slice(index, cursor).trim()
    values.push(raw === 'NULL' ? null : raw)
    index = cursor
  }

  return values
}

function parseWorkspaceRow(values) {
  const columns = values.slice(4, 17)
  if (columns.length !== 13) {
    return null
  }

  const [
    id,
    name,
    workspacePath,
    worktreesRoot,
    viewportX,
    viewportY,
    viewportZoom,
    isMinimapVisible,
    activeSpaceId,
    pullRequestBaseBranchOptionsJson,
    spaceArchiveRecordsJson,
    sortOrder,
    environmentVariablesJson,
  ] = columns

  if (
    !isUuid(id) ||
    typeof name !== 'string' ||
    isUuid(name) ||
    !isAbsolutePathLike(workspacePath)
  ) {
    return null
  }

  return {
    id,
    name,
    path: workspacePath,
    worktreesRoot: coalesceString(worktreesRoot, ''),
    viewportX: parseNumber(viewportX) ?? 0,
    viewportY: parseNumber(viewportY) ?? 0,
    viewportZoom: parseNumber(viewportZoom) ?? 1,
    isMinimapVisible: parseBooleanInteger(isMinimapVisible),
    activeSpaceId: isUuid(activeSpaceId) ? activeSpaceId : null,
    pullRequestBaseBranchOptionsJson: coalesceString(pullRequestBaseBranchOptionsJson, '[]'),
    spaceArchiveRecordsJson: coalesceString(spaceArchiveRecordsJson, '[]'),
    sortOrder: parseInteger(sortOrder) ?? 0,
    environmentVariablesJson: coalesceString(environmentVariablesJson, '{}'),
  }
}

function parseSpaceRow(values) {
  const columns = values.slice(4, 17)
  if (columns.length !== 13) {
    return null
  }

  const [
    id,
    workspaceId,
    name,
    directoryPath,
    rectX,
    rectY,
    rectWidth,
    rectHeight,
    labelColor,
    targetMountId,
    parentSpaceId,
    boundaryJson,
    sortOrder,
  ] = columns

  if (
    !isUuid(id) ||
    !isUuid(workspaceId) ||
    typeof name !== 'string' ||
    !isAbsolutePathLike(directoryPath)
  ) {
    return null
  }

  return {
    id,
    workspaceId,
    name,
    directoryPath,
    rectX: parseNumber(rectX),
    rectY: parseNumber(rectY),
    rectWidth: parseNumber(rectWidth),
    rectHeight: parseNumber(rectHeight),
    labelColor: parseNullableString(labelColor),
    targetMountId: isUuid(targetMountId) ? targetMountId : null,
    parentSpaceId: isUuid(parentSpaceId) ? parentSpaceId : null,
    boundaryJson: coalesceString(boundaryJson, '{}'),
    sortOrder: parseInteger(sortOrder) ?? 0,
  }
}

function parseNodeRow(values) {
  const columns = values.slice(4, 28)
  if (![19, 20, 24].includes(columns.length)) {
    return null
  }

  const [
    id,
    workspaceId,
    title,
    titlePinnedByUser,
    positionX,
    positionY,
    width,
    height,
    kind,
    status,
    startedAt,
    endedAt,
    exitCode,
    lastError,
    executionDirectory,
    expectedDirectory,
    agentJson,
    taskJson,
    labelColorOverride,
    sessionId,
    profileId,
    runtimeKind,
    terminalGeometryJson,
    terminalProviderHint,
  ] = columns

  if (
    !isUuid(id) ||
    !isUuid(workspaceId) ||
    typeof title !== 'string' ||
    typeof kind !== 'string'
  ) {
    return null
  }

  return {
    id,
    workspaceId,
    title,
    titlePinnedByUser: parseInteger(titlePinnedByUser) ?? 0,
    positionX: parseNumber(positionX) ?? 0,
    positionY: parseNumber(positionY) ?? 0,
    width: parseInteger(width) ?? 0,
    height: parseInteger(height) ?? 0,
    kind,
    status: parseNullableString(status),
    startedAt: parseNullableString(startedAt),
    endedAt: parseNullableString(endedAt),
    exitCode: parseInteger(exitCode),
    lastError: parseNullableString(lastError),
    executionDirectory: parseNullableString(executionDirectory),
    expectedDirectory: parseNullableString(expectedDirectory),
    agentJson: parseNullableString(agentJson),
    taskJson: parseNullableString(taskJson),
    labelColorOverride: parseNullableString(labelColorOverride),
    sessionId: parseNullableString(sessionId),
    profileId: parseNullableString(profileId),
    runtimeKind: parseNullableString(runtimeKind),
    terminalGeometryJson: parseNullableString(terminalGeometryJson),
    terminalProviderHint: parseNullableString(terminalProviderHint),
  }
}

function parseSpaceNodeLink(values) {
  const columns = values.slice(4, 7)
  if (columns.length !== 3) {
    return null
  }

  const [spaceId, nodeId, sortOrder] = columns
  if (!isUuid(spaceId) || !isUuid(nodeId)) {
    return null
  }

  return {
    spaceId,
    nodeId,
    sortOrder: parseInteger(sortOrder) ?? 0,
  }
}

function parseScrollbackRow(values) {
  const columns = values.slice(4, 7)
  if (columns.length !== 3) {
    return null
  }

  const [nodeId, scrollback, updatedAt] = columns
  if (!isUuid(nodeId) || typeof updatedAt !== 'string') {
    return null
  }

  return {
    nodeId,
    scrollback: coalesceString(scrollback, ''),
    updatedAt,
  }
}

function parseRecoverSqlText(sqlText) {
  return sqlText
    .split(/\r?\n/u)
    .map(line => line.trimStart())
    .filter(line => /^INSERT INTO lost_and_found VALUES\s*\(/u.test(line))
    .map(parseInsertValues)
    .filter(Boolean)
}

async function readRecoverRows(recoverSqlPath) {
  const sqlText = await readFile(recoverSqlPath, 'utf8')
  return parseRecoverSqlText(sqlText)
}

async function runSqlite3(sqlite3Bin, args) {
  try {
    return await execFile(sqlite3Bin, args, { maxBuffer: 50 * 1024 * 1024 })
  } catch (error) {
    throw new Error(
      `Failed to run sqlite3 (${sqlite3Bin} ${args.map(arg => JSON.stringify(arg)).join(' ')}): ${toErrorMessage(error)}`,
      { cause: error },
    )
  }
}

async function readScalarValue(sqlite3Bin, sourceDbPath, query) {
  const { stdout } = await runSqlite3(sqlite3Bin, [
    '-readonly',
    sourceDbPath,
    '-cmd',
    '.mode list',
    query,
  ])
  return stdout.trim()
}

async function readAppSettingsJson(sqlite3Bin, sourceDbPath) {
  const value = await readScalarValue(
    sqlite3Bin,
    sourceDbPath,
    'select value from app_settings where id = 1;',
  )
  return value.length > 0 ? value : '{}'
}

async function readAppMetaText(sqlite3Bin, sourceDbPath, key) {
  return await readScalarValue(
    sqlite3Bin,
    sourceDbPath,
    `select value from app_meta where key = ${sqliteLiteral(key)} limit 1;`,
  )
}

async function readAppStateRevision(sqlite3Bin, sourceDbPath) {
  const raw = await readAppMetaText(sqlite3Bin, sourceDbPath, 'app_state_revision')
  const parsed = typeof raw === 'string' && raw.length > 0 ? Number.parseInt(raw, 10) : 0
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

async function readAppStateFormatVersion(sqlite3Bin, sourceDbPath) {
  const raw = await readAppMetaText(sqlite3Bin, sourceDbPath, 'format_version')
  const parsed = typeof raw === 'string' && raw.length > 0 ? Number.parseInt(raw, 10) : 0
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : PERSISTED_APP_STATE_FORMAT_VERSION
}

async function dumpTableInserts(sqlite3Bin, sourceDbPath, tableName) {
  const { stdout } = await runSqlite3(sqlite3Bin, [
    '-readonly',
    sourceDbPath,
    '-cmd',
    `.mode insert ${tableName}`,
    `select * from ${tableName};`,
  ])

  return stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
}

async function collectBrowserTableInserts(sqlite3Bin, sourceDbPath) {
  const tableNames = [
    'browser_profile_settings',
    'browser_history',
    'browser_bookmarks',
    'browser_downloads',
    'browser_permission_decisions',
  ]

  const statements = []
  const warnings = []

  const tableResults = await Promise.all(
    tableNames.map(async tableName => {
      try {
        return {
          statements: await dumpTableInserts(sqlite3Bin, sourceDbPath, tableName),
          warning: null,
        }
      } catch (error) {
        return {
          statements: [],
          warning: `Skipped ${tableName}: ${toErrorMessage(error)}`,
        }
      }
    }),
  )

  for (const result of tableResults) {
    statements.push(...result.statements)
    if (result.warning) {
      warnings.push(result.warning)
    }
  }

  return { statements, warnings }
}

function makeWorkspaceInsert(workspace) {
  return `INSERT INTO workspaces (
id, name, path, worktrees_root, viewport_x, viewport_y, viewport_zoom, is_minimap_visible,
active_space_id, pull_request_base_branch_options_json, space_archive_records_json, sort_order, environment_variables_json
) VALUES (
${sqliteLiteral(workspace.id)},
${sqliteLiteral(workspace.name)},
${sqliteLiteral(workspace.path)},
${sqliteLiteral(workspace.worktreesRoot)},
${sqliteLiteral(workspace.viewportX)},
${sqliteLiteral(workspace.viewportY)},
${sqliteLiteral(workspace.viewportZoom)},
${sqliteLiteral(workspace.isMinimapVisible)},
${sqliteLiteral(workspace.activeSpaceId)},
${sqliteLiteral(workspace.pullRequestBaseBranchOptionsJson)},
${sqliteLiteral(workspace.spaceArchiveRecordsJson)},
${sqliteLiteral(workspace.sortOrder)},
${sqliteLiteral(workspace.environmentVariablesJson)}
);`
}

function makeSpaceInsert(space) {
  return `INSERT INTO workspace_spaces (
id, workspace_id, name, directory_path, rect_x, rect_y, rect_width, rect_height,
label_color, target_mount_id, parent_space_id, boundary_json, sort_order
) VALUES (
${sqliteLiteral(space.id)},
${sqliteLiteral(space.workspaceId)},
${sqliteLiteral(space.name)},
${sqliteLiteral(space.directoryPath)},
${sqliteLiteral(space.rectX)},
${sqliteLiteral(space.rectY)},
${sqliteLiteral(space.rectWidth)},
${sqliteLiteral(space.rectHeight)},
${sqliteLiteral(space.labelColor)},
${sqliteLiteral(space.targetMountId)},
${sqliteLiteral(space.parentSpaceId)},
${sqliteLiteral(space.boundaryJson)},
${sqliteLiteral(space.sortOrder)}
);`
}

function makeNodeInsert(node) {
  return `INSERT INTO nodes (
id, workspace_id, title, title_pinned_by_user, position_x, position_y, width, height,
kind, status, started_at, ended_at, exit_code, last_error, execution_directory, expected_directory,
agent_json, task_json, label_color_override, session_id, profile_id, runtime_kind,
terminal_geometry_json, terminal_provider_hint
) VALUES (
${sqliteLiteral(node.id)},
${sqliteLiteral(node.workspaceId)},
${sqliteLiteral(node.title)},
${sqliteLiteral(node.titlePinnedByUser)},
${sqliteLiteral(node.positionX)},
${sqliteLiteral(node.positionY)},
${sqliteLiteral(node.width)},
${sqliteLiteral(node.height)},
${sqliteLiteral(node.kind)},
${sqliteLiteral(node.status)},
${sqliteLiteral(node.startedAt)},
${sqliteLiteral(node.endedAt)},
${sqliteLiteral(node.exitCode)},
${sqliteLiteral(node.lastError)},
${sqliteLiteral(node.executionDirectory)},
${sqliteLiteral(node.expectedDirectory)},
${sqliteLiteral(node.agentJson)},
${sqliteLiteral(node.taskJson)},
${sqliteLiteral(node.labelColorOverride)},
${sqliteLiteral(node.sessionId)},
${sqliteLiteral(node.profileId)},
${sqliteLiteral(node.runtimeKind)},
${sqliteLiteral(node.terminalGeometryJson)},
${sqliteLiteral(node.terminalProviderHint)}
);`
}

function makeSpaceNodeInsert(link) {
  return `INSERT INTO workspace_space_nodes (space_id, node_id, sort_order) VALUES (
${sqliteLiteral(link.spaceId)},
${sqliteLiteral(link.nodeId)},
${sqliteLiteral(link.sortOrder)}
);`
}

function makeScrollbackInsert(scrollback, tableName) {
  return `INSERT INTO ${tableName} (node_id, scrollback, updated_at) VALUES (
${sqliteLiteral(scrollback.nodeId)},
${sqliteLiteral(scrollback.scrollback)},
${sqliteLiteral(scrollback.updatedAt)}
);`
}

function buildSchemaSql({ formatVersion, activeWorkspaceId, appStateRevision, settingsJson }) {
  return `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  worktrees_root TEXT NOT NULL,
  viewport_x REAL NOT NULL,
  viewport_y REAL NOT NULL,
  viewport_zoom REAL NOT NULL,
  is_minimap_visible INTEGER NOT NULL,
  active_space_id TEXT,
  pull_request_base_branch_options_json TEXT NOT NULL DEFAULT '[]',
  space_archive_records_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  environment_variables_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE nodes (
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
  task_json TEXT,
  label_color_override TEXT,
  session_id TEXT,
  profile_id TEXT,
  runtime_kind TEXT,
  terminal_geometry_json TEXT,
  terminal_provider_hint TEXT
);

CREATE TABLE workspace_spaces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  rect_x REAL,
  rect_y REAL,
  rect_width REAL,
  rect_height REAL,
  label_color TEXT,
  target_mount_id TEXT,
  parent_space_id TEXT,
  boundary_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE workspace_space_nodes (
  space_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (space_id, node_id)
);

CREATE TABLE node_scrollback (
  node_id TEXT PRIMARY KEY,
  scrollback TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_node_placeholder_scrollback (
  node_id TEXT PRIMARY KEY,
  scrollback TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE browser_profile_settings (
  profile_key TEXT PRIMARY KEY,
  homepage_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE browser_history (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  favicon_url TEXT,
  visit_count INTEGER NOT NULL,
  last_visited_at TEXT NOT NULL
);

CREATE TABLE browser_bookmarks (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  favicon_url TEXT,
  folder_id TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE browser_downloads (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  save_path TEXT,
  state TEXT NOT NULL,
  received_bytes INTEGER NOT NULL,
  total_bytes INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT
);

CREATE TABLE browser_permission_decisions (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL,
  origin TEXT NOT NULL,
  permission TEXT NOT NULL,
  decision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX browser_history_profile_visited_idx
  ON browser_history (profile_key, last_visited_at);
CREATE UNIQUE INDEX browser_history_profile_url_unique_idx
  ON browser_history (profile_key, url);
CREATE INDEX browser_bookmarks_profile_updated_idx
  ON browser_bookmarks (profile_key, updated_at);
CREATE UNIQUE INDEX browser_bookmarks_profile_url_unique_idx
  ON browser_bookmarks (profile_key, url);
CREATE INDEX browser_downloads_profile_started_idx
  ON browser_downloads (profile_key, started_at);
CREATE UNIQUE INDEX browser_permissions_profile_origin_permission_unique_idx
  ON browser_permission_decisions (profile_key, origin, permission);

INSERT INTO app_meta (key, value) VALUES ('format_version', ${sqliteLiteral(formatVersion)});
INSERT INTO app_meta (key, value) VALUES ('active_workspace_id', ${sqliteLiteral(activeWorkspaceId ?? '')});
INSERT INTO app_meta (key, value) VALUES ('app_state_revision', ${sqliteLiteral(appStateRevision)});
INSERT INTO app_settings (id, value) VALUES (1, ${sqliteLiteral(settingsJson)});
PRAGMA user_version = ${DB_SCHEMA_VERSION};
`
}

async function runSqliteScript(sqlite3Bin, dbPath, scriptPath) {
  await runSqlite3(sqlite3Bin, [dbPath, sqliteReadCommand(scriptPath)])
}

async function createEmptyRecoveredDb(sqlite3Bin, outputDbPath, recoveryMeta) {
  await rm(outputDbPath, { force: true })

  const workingDir = await mkdtemp(path.join(tmpdir(), 'opencove-db-recover-'))
  try {
    const schemaPath = path.join(workingDir, 'schema.sql')
    await writeFile(schemaPath, buildSchemaSql(recoveryMeta), 'utf8')
    await runSqliteScript(sqlite3Bin, outputDbPath, schemaPath)
  } finally {
    await rm(workingDir, { recursive: true, force: true })
  }
}

async function importRows(sqlite3Bin, outputDbPath, sqlStatements) {
  const workingDir = await mkdtemp(path.join(tmpdir(), 'opencove-db-recover-'))
  try {
    const importPath = path.join(workingDir, 'import.sql')
    await writeFile(importPath, `${sqlStatements.join('\n')}\n`, 'utf8')
    await runSqliteScript(sqlite3Bin, outputDbPath, importPath)
  } finally {
    await rm(workingDir, { recursive: true, force: true })
  }
}

async function readValidationSummary(sqlite3Bin, outputDbPath) {
  const query = `
select 'workspaces', count(*) from workspaces;
select 'workspace_spaces', count(*) from workspace_spaces;
select 'workspace_space_nodes', count(*) from workspace_space_nodes;
select 'nodes', count(*) from nodes;
select 'node_scrollback', count(*) from node_scrollback;
select 'agent_node_placeholder_scrollback', count(*) from agent_node_placeholder_scrollback;
select 'active_workspace_id', value from app_meta where key = 'active_workspace_id';
`
  const { stdout } = await runSqlite3(sqlite3Bin, [outputDbPath, '-cmd', '.mode list', query])
  return stdout.trim()
}

function resolveTargetWorkspace(workspaceMap, selector) {
  const workspaceList = [...workspaceMap.values()]

  if (selector.workspaceId) {
    const match = workspaceMap.get(selector.workspaceId)
    if (match) {
      return match
    }

    throw new Error(
      `Target workspace id not found: ${selector.workspaceId}. Available workspaces: ${workspaceList
        .map(workspace => `${workspace.id} (${workspace.name} @ ${workspace.path})`)
        .join(', ')}`,
    )
  }

  let candidates = workspaceList
  if (selector.workspaceName) {
    candidates = candidates.filter(workspace => workspace.name === selector.workspaceName)
  }
  if (selector.workspacePath) {
    candidates = candidates.filter(workspace => workspace.path === selector.workspacePath)
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  if (candidates.length > 1) {
    throw new Error(
      `Workspace selector is ambiguous (${selector.workspaceName ?? '*'} @ ${
        selector.workspacePath ?? '*'
      }). Candidates: ${candidates
        .map(workspace => `${workspace.id} (${workspace.name} @ ${workspace.path})`)
        .join(', ')}`,
    )
  }

  if (workspaceList.length === 1) {
    return workspaceList[0]
  }

  throw new Error(
    `Target workspace not found. Provide --workspace-id or an exact --workspace-name/--workspace-path pair. Available workspaces: ${workspaceList
      .map(workspace => `${workspace.id} (${workspace.name} @ ${workspace.path})`)
      .join(', ')}`,
  )
}

function buildSummary({ outputDbPath, targetWorkspace, counts, validationSummary, warnings }) {
  return JSON.stringify(
    {
      outputDbPath,
      targetWorkspace: {
        id: targetWorkspace.id,
        name: targetWorkspace.name,
        path: targetWorkspace.path,
        activeSpaceId: targetWorkspace.activeSpaceId,
      },
      counts,
      warnings,
      validationSummary,
    },
    null,
    2,
  )
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const { values: cliValues, positionals } = parseCli(
    rawArgs.length > 0 && rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  )

  if (cliValues.help === true) {
    printUsage()
    return
  }

  if (positionals.length > 3) {
    throw new Error(`Unexpected extra positional arguments: ${positionals.slice(3).join(' ')}`)
  }

  const recoverSqlPath = normalizeArg(cliValues['recover-sql']) ?? normalizeArg(positionals[0])
  const sourceDbPath = normalizeArg(cliValues['source-db']) ?? normalizeArg(positionals[1])
  const outputDbPath = normalizeArg(cliValues['output-db']) ?? normalizeArg(positionals[2])
  const workspaceId = normalizeArg(cliValues['workspace-id'])
  const workspaceName = normalizeArg(cliValues['workspace-name'])
  const workspacePath = normalizeArg(cliValues['workspace-path'])
  const sqlite3Bin = normalizeArg(cliValues['sqlite3-bin']) ?? DEFAULT_SQLITE3_BIN

  if (!recoverSqlPath) {
    throw new Error('Missing required input: --recover-sql')
  }
  if (!sourceDbPath) {
    throw new Error('Missing required input: --source-db')
  }
  if (!outputDbPath) {
    throw new Error('Missing required input: --output-db')
  }

  const rawRows = await readRecoverRows(recoverSqlPath)
  const appSettingsJson = await readAppSettingsJson(sqlite3Bin, sourceDbPath)
  const formatVersion = await readAppStateFormatVersion(sqlite3Bin, sourceDbPath)
  const appStateRevision = await readAppStateRevision(sqlite3Bin, sourceDbPath)
  const browserTables = await collectBrowserTableInserts(sqlite3Bin, sourceDbPath)

  const workspaceById = new Map()
  const spaceById = new Map()
  const nodeById = new Map()
  const scrollbackByNodeId = new Map()
  const linkByCompositeId = new Map()

  for (const rowValues of rawRows) {
    const nfield = parseInteger(rowValues[2])

    if (nfield === 13) {
      const workspace = parseWorkspaceRow(rowValues)
      if (workspace) {
        const previous = workspaceById.get(workspace.id)
        if (!previous || scoreCompleteness(workspace) >= scoreCompleteness(previous)) {
          workspaceById.set(workspace.id, workspace)
        }
        continue
      }

      const space = parseSpaceRow(rowValues)
      if (space) {
        const previous = spaceById.get(space.id)
        if (!previous || scoreCompleteness(space) >= scoreCompleteness(previous)) {
          spaceById.set(space.id, space)
        }
        continue
      }
    }

    if (nfield === 10) {
      const space = parseSpaceRow(values)
      if (space) {
        const previous = spaceById.get(space.id)
        if (!previous || scoreCompleteness(space) >= scoreCompleteness(previous)) {
          spaceById.set(space.id, space)
        }
        continue
      }
    }

    if (nfield === 19 || nfield === 20 || nfield === 24) {
      const node = parseNodeRow(rowValues)
      if (node) {
        const previous = nodeById.get(node.id)
        if (!previous || scoreCompleteness(node) >= scoreCompleteness(previous)) {
          nodeById.set(node.id, node)
        }
        continue
      }
    }

    if (nfield === 3) {
      const link = parseSpaceNodeLink(rowValues)
      if (link) {
        linkByCompositeId.set(`${link.spaceId}:${link.nodeId}`, link)
        continue
      }

      const scrollback = parseScrollbackRow(rowValues)
      if (scrollback) {
        scrollbackByNodeId.set(scrollback.nodeId, scrollback)
      }
    }
  }

  if (workspaceById.size === 0) {
    throw new Error(`No workspace rows were recovered from ${recoverSqlPath}`)
  }

  const targetWorkspace = resolveTargetWorkspace(workspaceById, {
    workspaceId,
    workspaceName,
    workspacePath,
  })

  const workspaceList = [...workspaceById.values()].sort((left, right) => {
    const sortComparison = left.sortOrder - right.sortOrder
    if (sortComparison !== 0) {
      return sortComparison
    }

    return left.name.localeCompare(right.name)
  })

  const spaceList = [...spaceById.values()].sort((left, right) => {
    const workspaceComparison = left.workspaceId.localeCompare(right.workspaceId)
    if (workspaceComparison !== 0) {
      return workspaceComparison
    }

    const sortComparison = left.sortOrder - right.sortOrder
    if (sortComparison !== 0) {
      return sortComparison
    }

    return left.name.localeCompare(right.name)
  })

  const nodeList = [...nodeById.values()].sort((left, right) => {
    const workspaceComparison = left.workspaceId.localeCompare(right.workspaceId)
    if (workspaceComparison !== 0) {
      return workspaceComparison
    }

    const startedComparison = (left.startedAt ?? '').localeCompare(right.startedAt ?? '')
    if (startedComparison !== 0) {
      return startedComparison
    }

    return left.id.localeCompare(right.id)
  })

  const spaceIdSet = new Set(spaceList.map(space => space.id))
  const nodeIdSet = new Set(nodeList.map(node => node.id))

  const linkList = [...linkByCompositeId.values()]
    .filter(link => spaceIdSet.has(link.spaceId) && nodeIdSet.has(link.nodeId))
    .sort((left, right) => {
      const spaceComparison = left.spaceId.localeCompare(right.spaceId)
      if (spaceComparison !== 0) {
        return spaceComparison
      }

      return left.sortOrder - right.sortOrder
    })

  const terminalScrollbacks = nodeList
    .filter(node => node.kind === 'terminal')
    .map(node => scrollbackByNodeId.get(node.id))
    .filter(Boolean)

  const agentPlaceholderScrollbacks = nodeList
    .filter(node => node.kind === 'agent')
    .map(node => scrollbackByNodeId.get(node.id))
    .filter(Boolean)

  const importStatements = [
    `UPDATE app_meta SET value = ${sqliteLiteral(targetWorkspace.id)} WHERE key = 'active_workspace_id';`,
    ...workspaceList.map(makeWorkspaceInsert),
    ...spaceList.map(makeSpaceInsert),
    ...nodeList.map(makeNodeInsert),
    ...linkList.map(makeSpaceNodeInsert),
    ...terminalScrollbacks.map(scrollback => makeScrollbackInsert(scrollback, 'node_scrollback')),
    ...agentPlaceholderScrollbacks.map(scrollback =>
      makeScrollbackInsert(scrollback, 'agent_node_placeholder_scrollback'),
    ),
    ...browserTables.statements,
  ]

  await createEmptyRecoveredDb(sqlite3Bin, outputDbPath, {
    formatVersion,
    activeWorkspaceId: targetWorkspace.id,
    appStateRevision,
    settingsJson: appSettingsJson,
  })
  await importRows(sqlite3Bin, outputDbPath, importStatements)

  const validationSummary = await readValidationSummary(sqlite3Bin, outputDbPath)

  for (const warning of browserTables.warnings) {
    process.stderr.write(`[recover] ${warning}\n`)
  }

  process.stdout.write(
    `${buildSummary({
      outputDbPath,
      targetWorkspace,
      counts: {
        workspaces: workspaceList.length,
        spaces: spaceList.length,
        nodes: nodeList.length,
        links: linkList.length,
        terminalScrollbacks: terminalScrollbacks.length,
        agentPlaceholderScrollbacks: agentPlaceholderScrollbacks.length,
        preservedBrowserRows: browserTables.statements.length,
      },
      validationSummary,
      warnings: browserTables.warnings,
    })}\n`,
  )
}

try {
  await main()
} catch (error) {
  process.stderr.write(`[recover] ${toErrorMessage(error)}\n`)
  process.exitCode = 1
}
