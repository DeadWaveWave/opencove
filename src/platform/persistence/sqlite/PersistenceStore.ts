import { createPersistenceScrollbackStore } from './PersistenceScrollbackStore'
import { createAppStateCommitObservation } from './appStateCommitObservation'
import {
  createManagedClaudeResumeRead,
  type ManagedClaudeResumeRead,
} from './managedClaudeResumeRead'
import type { AppStateCommittedObservation } from '../../../shared/contracts/managedClaudeLaunch'
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
import type { PersistWriteResult } from '../../../shared/contracts/dto'
import { backupDbFile, moveCorruptDbAside } from './dbFiles'
import { DB_SCHEMA_VERSION, DEFAULT_MAX_WORKSPACE_STATE_RAW_BYTES } from './constants'
import { migrate } from './migrate'
import { normalizePersistedAppState } from './normalize'
import { readAppStateFromDb, readWorkspaceStateRawFromDb } from './read'
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
  commitManagedClaudeRebind?: ManagedClaudeResumeBindingStore['commitManagedClaudeRebind']
  managedClaudeNodeIdForRuntime?: ManagedClaudeResumeRead['managedClaudeNodeIdForRuntime']
  observeManagedClaudeNode?: ManagedClaudeResumeRead['observeManagedClaudeNode']
  managedClaudePreparationCandidates?: ManagedClaudeResumeRead['managedClaudePreparationCandidates']
  isManagedClaudeRuntimeReferenced?: ManagedClaudeResumeRead['isManagedClaudeRuntimeReferenced']
  activateManagedClaudeRuntime?: ManagedClaudeResumeBindingStore['activateManagedClaudeRuntime']
  onAppStateCommitted?: (listener: (event: AppStateCommittedObservation) => void) => () => void
  nodeLineage?: NodeLineageRepository
  commitCreatedNodeState?: (
    state: unknown,
    options: { expectedRevision: number; lineage: NodeLineageRecord },
  ) => Promise<InternalPersistWriteResult>
  readWorkspaceStateRaw: () => Promise<string | null>
  writeWorkspaceStateRaw: (raw: string) => Promise<InternalPersistWriteResult>

  readAppStateSnapshot?: () => Promise<{ state: unknown | null; revision: number | null }>
  readAppState: () => Promise<unknown | null>
  isAppStateRevisionCurrent?: (revision: number) => boolean
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
}): Promise<
  PersistenceStore &
    ManagedClaudeResumeBindingStore &
    ManagedClaudeResumeRead & {
      onAppStateCommitted: (listener: (event: AppStateCommittedObservation) => void) => () => void
    }
> {
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
  const commits = createAppStateCommitObservation(sqlite)

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
      const { result, event } = sqlite.transaction(() => {
        const before = commits.capture()
        const written = writeNormalizedAppState(sqlite, normalized)
        writeNormalizedScrollbacks(sqlite, written.effectiveState)
        return { result: written, event: commits.describe(before, written.revision) }
      })()
      commits.publish(event)
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
      const { result, event } = sqlite.transaction(() => {
        const before = commits.capture()
        const written = writeNormalizedAppState(sqlite, normalized, options?.expectedRevision)
        if (lineage) {
          if (
            !written.effectiveState.workspaces.some(w => w.nodes.some(n => n.id === lineage.nodeId))
          ) {
            throw createAppError('persistence.invalid_state')
          }
          insertNodeLineage(sqlite, lineage)
        }
        return { result: written, event: commits.describe(before, written.revision) }
      })()
      commits.publish(event)
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

  const atCleanBoundary =
    <Args extends unknown[], Result>(operation: (...args: Args) => Result) =>
    (...args: Args): Result => {
      if (sqlite.inTransaction) {
        throw createAppError('persistence.unavailable')
      }
      return operation(...args)
    }

  return {
    nodeLineage: createSqliteNodeLineageRepository(sqlite),
    commitCreatedNodeState: atCleanBoundary((state, options) =>
      persistAppState(state, { expectedRevision: options.expectedRevision }, options.lineage),
    ),
    ...createManagedClaudeResumeStore(
      sqlite,
      () => readAppStateFromDb(db),
      (revision, operationId) => {
        commits.publish({
          revision,
          operationId,
          removedNodeIds: [],
          removedRuntimeSessionIds: [],
          removedManagedRuntimeSessionIds: [],
        })
      },
    ),
    ...createManagedClaudeResumeRead(sqlite),
    onAppStateCommitted: commits.subscribe,
    readAppStateSnapshot: atCleanBoundary(readAppStateSnapshot),
    readWorkspaceStateRaw: atCleanBoundary(readWorkspaceStateRaw),
    writeWorkspaceStateRaw: atCleanBoundary(writeWorkspaceStateRaw),
    readAppState: atCleanBoundary(readAppState),
    isAppStateRevisionCurrent: revision => readAppStateRevisionFromDb(sqlite) === revision,
    readAppStateRevision: atCleanBoundary(readAppStateRevision),
    writeAppState: atCleanBoundary((state, options) => persistAppState(state, options)),
    ...createPersistenceScrollbackStore(sqlite, db),
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
