import type Database from 'better-sqlite3'
import { DB_SCHEMA_VERSION, LEGACY_WORKSPACE_STATE_KEY } from './constants'
import { normalizePersistedAppState } from './normalize'
import { safeJsonParse } from './utils'
import { writeNormalizedAppState, writeNormalizedScrollbacks } from './write'

function quoteSqliteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe sqlite identifier: ${value}`)
  }

  return `"${value}"`
}

function createTables(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

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
      pull_request_base_branch_options_json TEXT NOT NULL DEFAULT '[]',
      space_archive_records_json TEXT NOT NULL DEFAULT '[]',
      viewport_x REAL NOT NULL,
      viewport_y REAL NOT NULL,
      viewport_zoom REAL NOT NULL,
      is_minimap_visible INTEGER NOT NULL,
      active_space_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      title_pinned_by_user INTEGER NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      kind TEXT NOT NULL,
      label_color_override TEXT,
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
      target_mount_id TEXT,
      label_color TEXT,
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
}

function readLegacyRawFromKv(db: Database.Database): string | null {
  try {
    const stmt = db.prepare('SELECT value FROM kv WHERE key = ?')
    const row = stmt.get(LEGACY_WORKSPACE_STATE_KEY) as { value: string } | undefined
    return typeof row?.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

function dropLegacyKv(db: Database.Database): void {
  try {
    db.exec('DROP TABLE IF EXISTS kv;')
  } catch {
    // ignore
  }
}

function listTableColumns(db: Database.Database, tableName: string): string[] {
  const statement = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`) as {
    all?: () => unknown[]
  }
  const rows = typeof statement.all === 'function' ? statement.all() : []

  return rows
    .map(row => {
      if (!row || typeof row !== 'object') {
        return ''
      }

      const name = (row as { name?: unknown }).name
      return typeof name === 'string' ? name.trim() : ''
    })
    .filter(name => name.length > 0)
}

function hasTableColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  return listTableColumns(db, tableName).includes(columnName)
}

function ensureTableColumn(
  db: Database.Database,
  options: { tableName: string; columnName: string; definitionSql: string },
): boolean {
  if (hasTableColumn(db, options.tableName, options.columnName)) {
    return false
  }

  db.exec(
    `ALTER TABLE ${quoteSqliteIdentifier(options.tableName)} ADD COLUMN ${quoteSqliteIdentifier(
      options.columnName,
    )} ${options.definitionSql}`,
  )

  return true
}

function backfillWorkspaceSortOrder(db: Database.Database): void {
  const allZero = db
    .prepare('SELECT COUNT(*) as cnt FROM workspaces WHERE sort_order != 0')
    .get() as {
    cnt: number
  }
  if (allZero.cnt > 0) {
    return
  }

  const rows = db.prepare('SELECT id FROM workspaces ORDER BY rowid').all() as { id: string }[]
  const update = db.prepare('UPDATE workspaces SET sort_order = ? WHERE id = ?')
  rows.forEach((row, index) => {
    update.run(index, row.id)
  })
}

function ensureCurrentSchema(db: Database.Database): void {
  createTables(db)

  ensureTableColumn(db, {
    tableName: 'workspaces',
    columnName: 'pull_request_base_branch_options_json',
    definitionSql: `TEXT NOT NULL DEFAULT '[]'`,
  })

  ensureTableColumn(db, {
    tableName: 'workspaces',
    columnName: 'space_archive_records_json',
    definitionSql: `TEXT NOT NULL DEFAULT '[]'`,
  })

  const addedWorkspaceSortOrder = ensureTableColumn(db, {
    tableName: 'workspaces',
    columnName: 'sort_order',
    definitionSql: 'INTEGER NOT NULL DEFAULT 0',
  })

  if (addedWorkspaceSortOrder) {
    backfillWorkspaceSortOrder(db)
  }

  ensureTableColumn(db, {
    tableName: 'nodes',
    columnName: 'label_color_override',
    definitionSql: 'TEXT',
  })

  ensureTableColumn(db, {
    tableName: 'nodes',
    columnName: 'session_id',
    definitionSql: 'TEXT',
  })

  ensureTableColumn(db, {
    tableName: 'workspace_spaces',
    columnName: 'label_color',
    definitionSql: 'TEXT',
  })

  ensureTableColumn(db, {
    tableName: 'workspace_spaces',
    columnName: 'target_mount_id',
    definitionSql: 'TEXT',
  })
}

export function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as unknown
  const currentVersion = typeof version === 'number' ? version : 0

  if (currentVersion >= DB_SCHEMA_VERSION) {
    ensureCurrentSchema(db)
    return
  }

  if (currentVersion === 1) {
    const legacyRaw = readLegacyRawFromKv(db)
    createTables(db)

    if (legacyRaw) {
      const parsed = safeJsonParse(legacyRaw)
      const normalized = normalizePersistedAppState(parsed)
      if (normalized) {
        writeNormalizedAppState(db, normalized)
        backfillWorkspaceSortOrder(db)
        writeNormalizedScrollbacks(db, normalized)
      }
    }

    dropLegacyKv(db)
    db.pragma(`user_version = ${DB_SCHEMA_VERSION}`)
    return
  }

  ensureCurrentSchema(db)
  db.pragma(`user_version = ${DB_SCHEMA_VERSION}`)
}
