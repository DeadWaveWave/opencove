import {
  createSqliteNodeLineageRepository,
  insertNodeLineage,
} from '../../../contexts/workspace/infrastructure/nodeLineage/SqliteNodeLineageRepository'
import type { NodeLineageRecord } from '../../../contexts/workspace/domain/nodeLineage'
import type { NodeLineageRepository } from '../../../contexts/workspace/application/nodeLineage/NodeLineageRepository'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import type { PersistWriteResult } from '../../../shared/contracts/dto'
import { backupDbFile, moveCorruptDbAside } from './dbFiles'
import { DB_SCHEMA_VERSION, DEFAULT_MAX_WORKSPACE_STATE_RAW_BYTES } from './constants'
import { migrate } from './migrate'
import { normalizePersistedAppState, normalizeScrollback } from './normalize'
import {
  readAppStateFromDb,
  readWorkspaceStateRawFromDb,
  readNodeScrollbackFromDb,
  readAgentNodePlaceholderScrollbackFromDb,
} from './read'
import { agentNodePlaceholderScrollback, nodeScrollback } from './schema'
import { safeJsonParse, safeJsonStringify, toErrorMessage, utf8ByteLength } from './utils'
import { writeNormalizedAppState, writeNormalizedScrollbacks } from './write'
import {
  createAppError,
  createAppErrorDescriptor,
  OpenCoveAppError,
} from '../../../shared/errors/appError'
import { PersistenceRevisionConflict } from './revisionConflict'
import type { ManagedClaudeResumeBindingStore } from '../../../shared/contracts/managedClaudeResumeBinding'
import {
  createManagedClaudeResumeStore,
  readAppStateRevisionFromDb,
} from './managedClaudeResumeStore'
import { sweepManagedClaudeResumeOrphans } from './managedClaudeResumeSchema'
import { invalidStateResult, type InternalPersistWriteResult } from './appStateWriteResult'

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface PersistenceStore {
  nodeLineage?: NodeLineageRepository
  commitCreatedNodeState?: (
    state: unknown,
    options: { expectedRevision: number; lineage: NodeLineageRecord },
  ) => Promise<InternalPersistWriteResult>
  readWorkspaceStateRaw: () => Promise<string | null>
  writeWorkspaceStateRaw: (raw: string) => Promise<InternalPersistWriteResult>

  readAppStateSnapshot?: () => Promise<{ state: unknown | null; revision: number | null }>
  readAppState: () => Promise<unknown | null>
  readAppStateRevision: () => Promise<number>
  writeAppState: (
    state: unknown,
    options?: WriteAppStateOptions,
  ) => Promise<InternalPersistWriteResult>

  readNodeScrollback: (nodeId: string) => Promise<string | null>
  writeNodeScrollback: (nodeId: string, scrollback: string | null) => Promise<PersistWriteResult>

  readAgentNodePlaceholderScrollback: (nodeId: string) => Promise<string | null>
  writeAgentNodePlaceholderScrollback: (
    nodeId: string,
    scrollback: string | null,
  ) => Promise<PersistWriteResult>

  consumeRecovery: () => PersistenceRecoveryReason | null
  dispose: () => void
}

export type WriteAppStateOptions = {
  baseRevision?: number | null
  allowEmptyWorkspaceOverwrite?: boolean
  expectedRevision?: number
}

function hasExistingWorkspaces(sqlite: Database.Database): boolean {
  const row = sqlite.prepare('SELECT 1 FROM workspaces LIMIT 1').get() as
    | { '1'?: unknown }
    | undefined
  return !!row
}

function shouldRejectEmptyWorkspaceOverwrite(
  sqlite: Database.Database,
  nextState: NonNullable<ReturnType<typeof normalizePersistedAppState>>,
  options: WriteAppStateOptions | undefined,
): boolean {
  if (nextState.workspaces.length > 0 || options?.allowEmptyWorkspaceOverwrite === true) {
    return false
  }

  return hasExistingWorkspaces(sqlite)
}

export async function createPersistenceStore(storeOptions: {
  dbPath: string
  maxRawBytes?: number
  strictRecovery?: boolean
}): Promise<PersistenceStore & ManagedClaudeResumeBindingStore> {
  const maxRawBytes = storeOptions.maxRawBytes ?? DEFAULT_MAX_WORKSPACE_STATE_RAW_BYTES

  await mkdir(dirname(storeOptions.dbPath), { recursive: true })

  const now = new Date()
  let recovery: PersistenceRecoveryReason | null = null

  let sqlite: Database.Database
  try {
    sqlite = new Database(storeOptions.dbPath)
  } catch (error) {
    if (storeOptions.strictRecovery) {
      throw error
    }
    recovery = 'corrupt_db'
    await moveCorruptDbAside(storeOptions.dbPath, now)
    sqlite = new Database(storeOptions.dbPath)
  }

  try {
    const version = sqlite.pragma('user_version', { simple: true }) as unknown
    const currentVersion = typeof version === 'number' ? version : 0
    if (storeOptions.strictRecovery && currentVersion > DB_SCHEMA_VERSION) {
      throw new Error('Managed runtime cannot downgrade this database schema.')
    }
    if (currentVersion < DB_SCHEMA_VERSION) {
      await backupDbFile(storeOptions.dbPath, now)
    }

    migrate(sqlite)
  } catch (error) {
    if (storeOptions.strictRecovery) {
      sqlite.close()
      throw error
    }
    recovery = 'migration_failed'

    try {
      sqlite.close()
    } catch {
      // ignore
    }

    await moveCorruptDbAside(storeOptions.dbPath, now)
    sqlite = new Database(storeOptions.dbPath)
    migrate(sqlite)
  }

  try {
    sweepManagedClaudeResumeOrphans(sqlite)
  } catch (error) {
    sqlite.close()
    throw error
  }
  const db = drizzle(sqlite)

  const readAppState = async (): Promise<unknown | null> => {
    try {
      return readAppStateFromDb(db)
    } catch (error) {
      throw createAppError('persistence.unavailable', {
        debugMessage: toErrorMessage(error),
      })
    }
  }

  const readAppStateSnapshot = async () => {
    try {
      return sqlite.transaction(() => ({
        revision: readAppStateRevisionFromDb(sqlite),
        state: readAppStateFromDb(db),
      }))()
    } catch (error) {
      throw createAppError('persistence.unavailable', {
        debugMessage: toErrorMessage(error),
      })
    }
  }

  const readAppStateRevision = async (): Promise<number> => {
    try {
      return readAppStateRevisionFromDb(sqlite)
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

  const writeWorkspaceStateRaw = async (raw: string): Promise<InternalPersistWriteResult> => {
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
      const result = sqlite.transaction(() => {
        const written = writeNormalizedAppState(sqlite, normalized)
        writeNormalizedScrollbacks(sqlite, written.effectiveState)
        return written
      })()
      return { ok: true, level: 'full', bytes: rawBytes, ...result }
    } catch (error) {
      if (
        error instanceof OpenCoveAppError &&
        error.code === 'persistence.owned_node_identity_conflict'
      ) {
        return { ok: false, reason: 'unknown', error: error.toDescriptor() }
      }
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  const persistAppState = async (
    state: unknown,
    options?: WriteAppStateOptions,
    lineage?: NodeLineageRecord,
  ): Promise<InternalPersistWriteResult> => {
    const normalized = normalizePersistedAppState(state)
    if (!normalized) {
      return invalidStateResult('Invalid app state payload.')
    }

    try {
      if (shouldRejectEmptyWorkspaceOverwrite(sqlite, normalized, options)) {
        return invalidStateResult(
          'Refusing to overwrite existing workspace state with an empty workspace list.',
        )
      }
    } catch {
      return invalidStateResult(
        'Refusing to persist an empty workspace list because the existing workspace state could not be verified.',
      )
    }

    try {
      const result = sqlite.transaction(() => {
        const written = writeNormalizedAppState(sqlite, normalized, options?.expectedRevision)
        if (lineage) {
          if (
            !written.effectiveState.workspaces.some(w => w.nodes.some(n => n.id === lineage.nodeId))
          ) {
            throw createAppError('persistence.invalid_state')
          }
          insertNodeLineage(sqlite, lineage)
        }
        return written
      })()
      const bytes = utf8ByteLength(safeJsonStringify(result.effectiveState))
      return { ok: true, level: 'full', bytes, ...result }
    } catch (error) {
      if (
        error instanceof OpenCoveAppError &&
        error.code === 'persistence.owned_node_identity_conflict'
      ) {
        return { ok: false, reason: 'unknown', error: error.toDescriptor() }
      }
      if (
        error instanceof PersistenceRevisionConflict ||
        (error instanceof OpenCoveAppError && error.code === 'persistence.invalid_state')
      ) {
        return invalidStateResult(error.message)
      }
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

  const readAgentNodePlaceholderScrollback = async (nodeId: string): Promise<string | null> => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return null
    }

    try {
      return readAgentNodePlaceholderScrollbackFromDb(db, normalized)
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

    try {
      const recoveryOwned = sqlite
        .prepare('SELECT 1 FROM terminal_recovery_records WHERE node_id = ? LIMIT 1')
        .get(normalizedNodeId)
      if (recoveryOwned) {
        // Once the Worker has reserved this node, renderer scrollback is only a view cache. A late
        // renderer flush must never overwrite (or delete) the Worker-owned durability mirror.
        return { ok: true, level: 'full', bytes: 0 }
      }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
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

  const writeAgentNodePlaceholderScrollback = async (
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
        db.delete(agentNodePlaceholderScrollback)
          .where(eq(agentNodePlaceholderScrollback.nodeId, normalizedNodeId))
          .run()
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
      db.insert(agentNodePlaceholderScrollback)
        .values({
          nodeId: normalizedNodeId,
          scrollback: normalizedScrollback,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: agentNodePlaceholderScrollback.nodeId,
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
    nodeLineage: createSqliteNodeLineageRepository(sqlite),
    commitCreatedNodeState: (state, options) =>
      persistAppState(state, { expectedRevision: options.expectedRevision }, options.lineage),
    ...createManagedClaudeResumeStore(sqlite, () => readAppStateFromDb(db)),
    readAppStateSnapshot,
    readWorkspaceStateRaw,
    writeWorkspaceStateRaw,
    readAppState,
    readAppStateRevision,
    writeAppState: (state, options) => persistAppState(state, options),
    readNodeScrollback,
    writeNodeScrollback,
    readAgentNodePlaceholderScrollback,
    writeAgentNodePlaceholderScrollback,
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
