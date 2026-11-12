import type Database from 'better-sqlite3'

/** Installation creates no authority. Adoption is an explicit, separate transaction. */
export function ensureTaskAuthoritySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_field_authority (
      node_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'note')),
      generation TEXT NOT NULL,
      active_holder_node_id TEXT,
      retired INTEGER NOT NULL CHECK (retired IN (0, 1)),
      fields_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS task_active_holder_idx
      ON task_field_authority(active_holder_node_id) WHERE active_holder_node_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS task_command_receipts (
      principal TEXT NOT NULL,
      operation TEXT NOT NULL,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result_json TEXT NOT NULL,
      PRIMARY KEY (principal, operation, request_id)
    );
    CREATE TABLE IF NOT EXISTS task_claim_holders (
      task_node_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      session_id TEXT,
      worker_binding_json TEXT
    );
  `)
}
