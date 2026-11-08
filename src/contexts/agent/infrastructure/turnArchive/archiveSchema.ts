import type Database from 'better-sqlite3'

export const AGENT_TURN_ARCHIVE_SCHEMA_VERSION = 2
export const AGENT_TURN_ARCHIVE_BUSY_MS = 50
export const AGENT_TURN_ARCHIVE_FILE = 'agent-turn-archive.db'

/** Read before any persistent PRAGMA/DDL; unsupported versions are never migrated down. */
export function assertArchiveVersion(db: Database.Database): void {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'archive_schema'")
    .get()
  if (!exists) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
      throw new Error('unknown archive schema')
    }
    return
  }
  const rows = db.prepare('SELECT version FROM archive_schema LIMIT 2').all() as {
    version: number
  }[]
  if (rows.length !== 1 || ![1, AGENT_TURN_ARCHIVE_SCHEMA_VERSION].includes(rows[0].version)) {
    throw new Error('unsupported archive schema')
  }
}

/** Cheap metadata aggregates only; never repair inconsistent accounting or sequences. */
export function validateArchiveBookkeeping(db: Database.Database): void {
  const rows = db
    .prepare(
      'SELECT id, version, next_seq, record_count, message_bytes FROM archive_schema LIMIT 2',
    )
    .all() as Array<{
    id: number
    version: number
    next_seq: number
    record_count: number
    message_bytes: number
  }>
  const totals = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq,
    COUNT(*) AS record_count, COALESCE(SUM(message_bytes), 0) AS message_bytes FROM ended_turns`,
    )
    .get() as {
    max_seq: number
    record_count: number
    message_bytes: number
  }
  const row = rows[0]
  if (
    rows.length !== 1 ||
    row.id !== 1 ||
    ![1, AGENT_TURN_ARCHIVE_SCHEMA_VERSION].includes(row.version) ||
    !Number.isSafeInteger(row.next_seq) ||
    row.next_seq <= totals.max_seq ||
    row.next_seq < 1 ||
    row.record_count !== totals.record_count ||
    row.message_bytes !== totals.message_bytes
  ) {
    throw new Error('inconsistent archive bookkeeping')
  }
}

export function createArchiveSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_schema (
      id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0, message_bytes INTEGER NOT NULL DEFAULT 0,
      next_seq INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO archive_schema (id, version) VALUES (1, 2) ON CONFLICT(id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS ended_turns (
      seq INTEGER NOT NULL UNIQUE,
      node_id TEXT NOT NULL, turn_id TEXT NOT NULL, session_id TEXT NOT NULL,
      provider TEXT NOT NULL, provider_session_id TEXT, prompt_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'aborted', 'unknown')),
      ended_at INTEGER NOT NULL, archived_at INTEGER NOT NULL,
      message TEXT, message_kind TEXT CHECK (message_kind IS NULL OR message_kind = 'intermediate'), truncated INTEGER NOT NULL, superseded INTEGER NOT NULL,
      message_bytes INTEGER NOT NULL CHECK (message_bytes BETWEEN 0 AND 65536),
      PRIMARY KEY (node_id, turn_id)
    );
    CREATE INDEX IF NOT EXISTS ended_turns_node_seq ON ended_turns (node_id, seq);
    CREATE INDEX IF NOT EXISTS ended_turns_session_turn ON ended_turns (session_id, turn_id);
    CREATE INDEX IF NOT EXISTS ended_turns_age ON ended_turns (archived_at, seq);
    CREATE TRIGGER IF NOT EXISTS ended_turns_insert AFTER INSERT ON ended_turns BEGIN
      UPDATE archive_schema SET record_count = record_count + 1,
        message_bytes = message_bytes + NEW.message_bytes,
        next_seq = MAX(next_seq, NEW.seq + 1) WHERE id = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS ended_turns_delete AFTER DELETE ON ended_turns BEGIN
      UPDATE archive_schema SET record_count = record_count - 1,
        message_bytes = message_bytes - OLD.message_bytes WHERE id = 1;
    END;
  `)
  const version = (
    db.prepare('SELECT version FROM archive_schema WHERE id = 1').get() as { version: number }
  ).version
  if (version === 1) {
    db.exec(
      "ALTER TABLE ended_turns ADD COLUMN message_kind TEXT CHECK (message_kind IS NULL OR message_kind = 'intermediate')",
    )
    db.exec('UPDATE archive_schema SET version = 2 WHERE id = 1')
  }
}
