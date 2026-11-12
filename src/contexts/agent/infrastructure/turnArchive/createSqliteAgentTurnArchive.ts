import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { AgentTurnArchive, ArchiveMembership } from '../../application/AgentTurnArchive'
import { createAgentTurnArchive } from '../../application/createAgentTurnArchive'
import { createSqliteArchiveStorage } from './SqliteAgentTurnArchiveStorage'
import {
  AGENT_TURN_ARCHIVE_BUSY_MS,
  AGENT_TURN_ARCHIVE_FILE,
  assertArchiveVersion,
  createArchiveSchema,
  validateArchiveBookkeeping,
} from './archiveSchema'

/** Optional independent store. No workspace migrator, recovery, rename, replacement or truncation. */
export function createSqliteAgentTurnArchive(options: {
  userDataPath: string
  now?: () => number
  membership?: ArchiveMembership
}): AgentTurnArchive {
  const path = resolve(options.userDataPath, AGENT_TURN_ARCHIVE_FILE)
  let db: Database.Database | undefined
  try {
    // Inspect version and bookkeeping read-only before WAL/DDL. Reject future schemas first;
    // do not perform whole-file integrity scans. Corruption on any SQL use disables the adapter.
    if (existsSync(path)) {
      const probe = new Database(path, {
        readonly: true,
        fileMustExist: true,
        timeout: AGENT_TURN_ARCHIVE_BUSY_MS,
      })
      try {
        assertArchiveVersion(probe)
        if (probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'archive_schema'").get()) {
          validateArchiveBookkeeping(probe)
        }
      } finally {
        probe.close()
      }
    }
    mkdirSync(dirname(path), { recursive: true })
    db = new Database(path, { timeout: AGENT_TURN_ARCHIVE_BUSY_MS })
    assertArchiveVersion(db)
    const connection = db
    // Prepare/validate the entire schema in the same transaction as its creation. A failure rolls
    // DDL back; never attempt a destructive repair of an existing unknown/broken schema.
    const storage = connection
      .transaction(() => {
        createArchiveSchema(connection)
        validateArchiveBookkeeping(connection)
        return createSqliteArchiveStorage(connection)
      })
      .immediate()
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') {
      throw new Error('WAL unavailable')
    }
    db.pragma('synchronous = NORMAL')
    db.pragma('wal_autocheckpoint = 0')
    return createAgentTurnArchive(storage, options.now, options.membership)
  } catch {
    try {
      db?.close()
    } catch {
      /* Best-effort handle cleanup; preserve the file. */
    }
    process.stderr.write('[opencove] ended-turn archive unavailable for this Worker run.\n')
    return createAgentTurnArchive(null, options.now, options.membership)
  }
}
