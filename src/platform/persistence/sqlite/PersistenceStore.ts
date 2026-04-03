import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import type { PersistWriteResult } from '../../../shared/contracts/dto'
import { backupDbFile, moveCorruptDbAside } from './dbFiles'
import { DB_SCHEMA_VERSION, DEFAULT_MAX_WORKSPACE_STATE_RAW_BYTES } from './constants'
import { migrate } from './migrate'
import { normalizePersistedAppState, normalizeScrollback } from './normalize'
import { readAppStateFromDb, readWorkspaceStateRawFromDb } from './read'
import { nodeScrollback } from './schema'
import { safeJsonParse, safeJsonStringify, toErrorMessage, utf8ByteLength } from './utils'
import { writeNormalizedAppState, writeNormalizedScrollbacks } from './write'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface PersistenceStore {
  readWorkspaceStateRaw: () => Promise<string | null>
  writeWorkspaceStateRaw: (raw: string) => Promise<PersistWriteResult>

  readAppState: () => Promise<unknown | null>
  readAppStateRevision: () => Promise<number>
  writeAppState: (state: unknown) => Promise<PersistWriteResult>

  readNodeScrollback: (nodeId: string) => Promise<string | null>
  writeNodeScrollback: (nodeId: string, scrollback: string | null) => Promise<PersistWriteResult>

  consumeRecovery: () => PersistenceRecoveryReason | null
  dispose: () => void
}

function readNodeScrollbackFromDb(db: BetterSQLite3Database, nodeId: string): string | null {
  const row = db
    .select({ scrollback: nodeScrollback.scrollback })
    .from(nodeScrollback)
    .where(eq(nodeScrollback.nodeId, nodeId))
    .get()
  return typeof row?.scrollback === 'string' ? row.scrollback : null
}

export async function createPersistenceStore(options: {
  dbPath: string
  maxRawBytes?: number
}): Promise<PersistenceStore> {
  const maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_WORKSPACE_STATE_RAW_BYTES

  await mkdir(dirname(options.dbPath), { recursive: true })

  const now = new Date()
  let recovery: PersistenceRecoveryReason | null = null

  let sqlite: Database.Database
  try {
    sqlite = new Database(options.dbPath)
  } catch {
    recovery = 'corrupt_db'
    await moveCorruptDbAside(options.dbPath, now)
    sqlite = new Database(options.dbPath)
  }

  try {
    const version = sqlite.pragma('user_version', { simple: true }) as unknown
    const currentVersion = typeof version === 'number' ? version : 0
    if (currentVersion < DB_SCHEMA_VERSION) {
      await backupDbFile(options.dbPath, now)
    }

    migrate(sqlite)
  } catch {
    recovery = 'migration_failed'

    try {
      sqlite.close()
    } catch {
      // ignore
    }

    await moveCorruptDbAside(options.dbPath, now)
    sqlite = new Database(options.dbPath)
    migrate(sqlite)
  }

  const db = drizzle(sqlite)

  const readAppState = async (): Promise<unknown | null> => {
    try {
      return readAppStateFromDb(db)
    } catch {
      return null
    }
  }

  const readAppStateRevision = async (): Promise<number> => {
    try {
      const row = sqlite
        .prepare(
          `
            SELECT value
            FROM app_meta
            WHERE key = 'app_state_revision'
            LIMIT 1
          `,
        )
        .get() as { value?: unknown } | undefined

      const parsed = typeof row?.value === 'string' ? Number.parseInt(row.value, 10) : 0
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    } catch {
      return 0
    }
  }

  const readWorkspaceStateRaw = async (): Promise<string | null> => {
    try {
      const state = readAppStateFromDb(db)
      return readWorkspaceStateRawFromDb(db, state)
    } catch {
      return null
    }
  }

  const writeWorkspaceStateRaw = async (raw: string): Promise<PersistWriteResult> => {
    const rawBytes = utf8ByteLength(raw)
    if (rawBytes > maxRawBytes) {
      return {
        ok: false,
        reason: 'payload_too_large',
        error: createAppErrorDescriptor('persistence.payload_too_large', {
          params: { bytes: rawBytes, maxBytes: maxRawBytes },
          debugMessage: `Workspace state payload too large to persist (${rawBytes} bytes).`,
        }),
      }
    }

    const parsed = safeJsonParse(raw)
    const normalized = normalizePersistedAppState(parsed)
    if (!normalized) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_state', {
          debugMessage: 'Workspace state payload must be a JSON object.',
        }),
      }
    }

    try {
      let revision = 0
      sqlite.transaction(() => {
        revision = writeNormalizedAppState(sqlite, normalized)
        writeNormalizedScrollbacks(sqlite, normalized)
      })()

      return { ok: true, level: 'full', bytes: rawBytes, revision }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  const writeAppState = async (state: unknown): Promise<PersistWriteResult> => {
    const normalized = normalizePersistedAppState(state)
    if (!normalized) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_state', {
          debugMessage: 'Invalid app state payload.',
        }),
      }
    }

    try {
      const revision = writeNormalizedAppState(sqlite, normalized)
      const bytes = utf8ByteLength(safeJsonStringify(normalized))
      return { ok: true, level: 'full', bytes, revision }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  const readNodeScrollback = async (nodeId: string): Promise<string | null> => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return null
    }

    try {
      return readNodeScrollbackFromDb(db, normalized)
    } catch {
      return null
    }
  }

  const writeNodeScrollback = async (
    nodeId: string,
    scrollback: string | null,
  ): Promise<PersistWriteResult> => {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_node_id', {
          debugMessage: 'Missing node id.',
        }),
      }
    }

    const normalizedScrollback = normalizeScrollback(scrollback)
    if (!normalizedScrollback) {
      try {
        db.delete(nodeScrollback).where(eq(nodeScrollback.nodeId, normalizedNodeId)).run()
        return { ok: true, level: 'full', bytes: 0 }
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toErrorMessage(error),
          }),
        }
      }
    }

    try {
      const nowIso = new Date().toISOString()
      db.insert(nodeScrollback)
        .values({ nodeId: normalizedNodeId, scrollback: normalizedScrollback, updatedAt: nowIso })
        .onConflictDoUpdate({
          target: nodeScrollback.nodeId,
          set: { scrollback: normalizedScrollback, updatedAt: nowIso },
        })
        .run()
      return { ok: true, level: 'full', bytes: utf8ByteLength(normalizedScrollback) }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  return {
    readWorkspaceStateRaw,
    writeWorkspaceStateRaw,
    readAppState,
    readAppStateRevision,
    writeAppState,
    readNodeScrollback,
    writeNodeScrollback,
    consumeRecovery: () => {
      const current = recovery
      recovery = null
      return current
    },
    dispose: () => {
      try {
        sqlite.close()
      } catch {
        // ignore
      }
    },
  }
}
