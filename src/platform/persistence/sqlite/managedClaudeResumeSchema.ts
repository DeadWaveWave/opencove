import type Database from 'better-sqlite3'

/** Additive v14 step, also used by schema-current repair and before the v1 writer. */
export function ensureManagedClaudeResumeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_claude_resume_bindings (
      node_id TEXT PRIMARY KEY,
      runtime_session_id TEXT,
      resume_session_id TEXT,
      resume_session_id_verified INTEGER NOT NULL,
      activation_id TEXT NOT NULL,
      node_seen INTEGER NOT NULL DEFAULT 0,
      updated_revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retired_managed_nodes (
      node_id TEXT PRIMARY KEY,
      retired_revision INTEGER NOT NULL,
      retired_at INTEGER NOT NULL
    );
  `)
}

export function sweepManagedClaudeResumeOrphans(db: Database.Database, now = Date.now()): void {
  db.prepare(
    `DELETE FROM managed_claude_resume_bindings
    WHERE node_seen = 0 AND updated_at < ?
    AND NOT EXISTS (SELECT 1 FROM nodes WHERE id = node_id)`,
  ).run(now - 24 * 60 * 60 * 1000)
}
