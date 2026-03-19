import type Database from 'better-sqlite3'
import { DB_SCHEMA_VERSION, LEGACY_WORKSPACE_STATE_KEY } from './constants'
import { normalizePersistedAppState } from './normalize'
import { safeJsonParse } from './utils'
import { writeNormalizedAppState, writeNormalizedScrollbacks } from './write'

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

export function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as unknown
  const currentVersion = typeof version === 'number' ? version : 0

  if (currentVersion >= DB_SCHEMA_VERSION) {
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
        writeNormalizedScrollbacks(db, normalized)
      }
    }

    dropLegacyKv(db)
    db.pragma(`user_version = ${DB_SCHEMA_VERSION}`)
    return
  }

  if (currentVersion === 2) {
    createTables(db)

    try {
      db.exec(`
        ALTER TABLE workspaces
        ADD COLUMN pull_request_base_branch_options_json TEXT NOT NULL DEFAULT '[]'
      `)
    } catch {
      // ignore (column already exists)
    }

    db.pragma(`user_version = ${DB_SCHEMA_VERSION}`)
    return
  }

  createTables(db)
  db.pragma(`user_version = ${DB_SCHEMA_VERSION}`)
}
