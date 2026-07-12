import type Database from 'better-sqlite3'
import type {
  BindTerminalRecoveryInput,
  CommitTerminalRecoveryInput,
  ReserveTerminalRecoveryInput,
  TerminalRecoveryPersistencePort,
} from '../../application/recovery/terminalRecoveryPorts'
import {
  bindTerminalRecoveryRecord,
  composeTerminalRecoveryScrollback,
  commitTerminalRecoveryRecord,
  reserveTerminalRecoveryRecord,
  TERMINAL_RECOVERY_FORMAT_VERSION,
  type TerminalArchivedEpoch,
  type TerminalPresentationCheckpoint,
  type TerminalRecoveryMutationResult,
  type TerminalRecoveryRecord,
  type TerminalRuntimeBinding,
} from '../../domain/recovery/terminalRecovery'
import { MAX_PERSISTED_SCROLLBACK_CHARS } from '../../../../platform/persistence/sqlite/constants'
import {
  legacyRecoveryChecksum,
  recoveryChecksum,
  recoveryChecksumWithoutReplayCursor,
} from './terminalRecoveryChecksum'

type RecoveryRow = {
  node_id: unknown
  format_version: unknown
  generation: unknown
  binding_json: unknown
  runtime_epoch: unknown
  checkpoint_revision: unknown
  applied_seq: unknown
  presentation_json: unknown
  raw_tail: unknown
  raw_truncated: unknown
  checksum: unknown
  updated_at: unknown
}

const SELECT_RECOVERY_SQL = `
  SELECT node_id, format_version, generation, binding_json, runtime_epoch,
         checkpoint_revision, applied_seq, presentation_json, raw_tail,
         raw_truncated, checksum, updated_at
  FROM terminal_recovery_records
  WHERE node_id = ?
  LIMIT 1
`

const UPSERT_RECOVERY_SQL = `
  INSERT INTO terminal_recovery_records (
    node_id, format_version, generation, binding_json, runtime_epoch,
    checkpoint_revision, applied_seq, presentation_json, raw_tail,
    raw_truncated, checksum, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(node_id) DO UPDATE SET
    format_version = excluded.format_version,
    generation = excluded.generation,
    binding_json = excluded.binding_json,
    runtime_epoch = excluded.runtime_epoch,
    checkpoint_revision = excluded.checkpoint_revision,
    applied_seq = excluded.applied_seq,
    presentation_json = excluded.presentation_json,
    raw_tail = excluded.raw_tail,
    raw_truncated = excluded.raw_truncated,
    checksum = excluded.checksum,
    updated_at = excluded.updated_at
`

export class SqliteTerminalRecoveryRepository implements TerminalRecoveryPersistencePort {
  public constructor(
    private readonly db: Database.Database,
    private readonly closeOnDispose = false,
  ) {}

  public async read(nodeId: string): Promise<TerminalRecoveryRecord | null> {
    if (!this.isTerminalNode(nodeId)) {
      return null
    }
    return this.readDurable(nodeId) ?? this.readLegacy(nodeId)
  }

  public async reserve(
    input: ReserveTerminalRecoveryInput,
  ): Promise<TerminalRecoveryMutationResult> {
    return this.runWriteTransaction(() => {
      if (!this.isTerminalNode(input.nodeId)) {
        return invalidNode()
      }
      const durable = this.readDurable(input.nodeId)
      const result = reserveTerminalRecoveryRecord({
        current: durable ?? this.readLegacy(input.nodeId),
        ...input,
      })
      if (result.ok) {
        this.upsert(result.record)
        this.mirrorLegacyScrollback(result.record)
      }
      return result
    })
  }

  public async bind(input: BindTerminalRecoveryInput): Promise<TerminalRecoveryMutationResult> {
    return this.runWriteTransaction(() => {
      if (!this.isTerminalNode(input.nodeId)) {
        return invalidNode()
      }
      const result = bindTerminalRecoveryRecord({
        current: this.readDurable(input.nodeId),
        ...input,
      })
      if (result.ok && result.changed) {
        this.upsert(result.record)
      }
      return result
    })
  }

  public async commit(input: CommitTerminalRecoveryInput): Promise<TerminalRecoveryMutationResult> {
    return this.runWriteTransaction(() => {
      if (!this.isTerminalNode(input.nodeId)) {
        return invalidNode()
      }
      const truncatedByRepository = input.rawTail.length > MAX_PERSISTED_SCROLLBACK_CHARS
      const rawTail = truncatedByRepository
        ? input.rawTail.slice(-MAX_PERSISTED_SCROLLBACK_CHARS)
        : input.rawTail
      const rawTruncated = input.rawTruncated || truncatedByRepository
      const current = this.readDurable(input.nodeId)
      const checksum = recoveryChecksum({
        archivedEpochs: current?.archivedEpochs ?? [],
        historyTruncated: current?.historyTruncated ?? false,
        checkpoint: input.checkpoint,
        rawTail,
        rawTruncated,
      })
      const result = commitTerminalRecoveryRecord({
        ...input,
        current,
        rawTail,
        rawTruncated,
        checksum,
      })
      if (result.ok) {
        this.upsert(result.record)
        this.mirrorLegacyScrollback(result.record)
      }
      return result
    })
  }

  public dispose(): void {
    if (this.closeOnDispose) {
      this.db.close()
    }
  }

  private isTerminalNode(nodeId: string): boolean {
    const row = this.db.prepare('SELECT kind FROM nodes WHERE id = ? LIMIT 1').get(nodeId) as
      | { kind?: unknown }
      | undefined
    return row?.kind === 'terminal'
  }

  private runWriteTransaction<TResult>(operation: () => TResult): TResult {
    return this.db.transaction(operation).immediate()
  }

  private readDurable(nodeId: string): TerminalRecoveryRecord | null {
    const row = this.db.prepare(SELECT_RECOVERY_SQL).get(nodeId) as RecoveryRow | undefined
    return row ? decodeRecoveryRow(row) : null
  }

  private readLegacy(nodeId: string): TerminalRecoveryRecord | null {
    const row = this.db
      .prepare('SELECT scrollback, updated_at FROM node_scrollback WHERE node_id = ? LIMIT 1')
      .get(nodeId) as { scrollback?: unknown; updated_at?: unknown } | undefined
    if (typeof row?.scrollback !== 'string') {
      return null
    }
    return {
      nodeId,
      formatVersion: TERMINAL_RECOVERY_FORMAT_VERSION,
      generation: 0,
      binding: null,
      archivedEpochs: [],
      historyTruncated: false,
      checkpoint: null,
      rawTail: row.scrollback,
      rawTruncated: false,
      checksum: null,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
    }
  }

  private upsert(record: TerminalRecoveryRecord): void {
    this.db
      .prepare(UPSERT_RECOVERY_SQL)
      .run(
        record.nodeId,
        record.formatVersion,
        record.generation,
        record.binding ? JSON.stringify(record.binding) : null,
        record.binding?.runtimeEpoch ?? null,
        record.checkpoint?.checkpointRevision ?? 0,
        record.checkpoint?.appliedSeq ?? 0,
        encodePresentationEnvelope(record),
        record.rawTail,
        record.rawTruncated ? 1 : 0,
        record.checksum,
        record.updatedAt,
      )
  }

  private mirrorLegacyScrollback(record: TerminalRecoveryRecord): void {
    this.db
      .prepare(
        `
          INSERT INTO node_scrollback (node_id, scrollback, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(node_id) DO UPDATE SET
            scrollback = excluded.scrollback,
            updated_at = excluded.updated_at
        `,
      )
      .run(record.nodeId, composeTerminalRecoveryScrollback(record), record.updatedAt)
  }
}

function decodeRecoveryRow(row: RecoveryRow): TerminalRecoveryRecord | null {
  if (
    typeof row.node_id !== 'string' ||
    row.format_version !== TERMINAL_RECOVERY_FORMAT_VERSION ||
    !isNonNegativeInteger(row.generation) ||
    typeof row.raw_tail !== 'string' ||
    (row.raw_truncated !== 0 && row.raw_truncated !== 1) ||
    (row.checksum !== null && typeof row.checksum !== 'string') ||
    typeof row.updated_at !== 'string'
  ) {
    return null
  }
  if ((row.binding_json === null) !== (row.runtime_epoch === null)) {
    return null
  }
  const binding = decodeBinding(row.binding_json, row.runtime_epoch)
  if (row.binding_json !== null && !binding) {
    return null
  }
  const presentation = decodePresentation(row)
  if (!presentation) {
    return null
  }
  const record: TerminalRecoveryRecord = {
    nodeId: row.node_id,
    formatVersion: TERMINAL_RECOVERY_FORMAT_VERSION,
    generation: row.generation,
    binding,
    archivedEpochs: presentation.archivedEpochs,
    historyTruncated: presentation.historyTruncated,
    checkpoint: presentation.checkpoint,
    rawTail: row.raw_tail,
    rawTruncated: row.raw_truncated === 1,
    checksum: typeof row.checksum === 'string' ? row.checksum : null,
    updatedAt: row.updated_at,
  }
  if (record.checksum) {
    const currentChecksum = recoveryChecksum({
      archivedEpochs: record.archivedEpochs,
      historyTruncated: record.historyTruncated,
      checkpoint: record.checkpoint,
      rawTail: record.rawTail,
      rawTruncated: record.rawTruncated,
    })
    const hasTrustedReplayCursor = typeof record.checkpoint?.downstreamReplayCursor === 'number'
    const matchesPreCursorChecksum =
      !hasTrustedReplayCursor &&
      (record.checksum === recoveryChecksumWithoutReplayCursor(record) ||
        record.checksum === legacyRecoveryChecksum(record))
    if (record.checksum !== currentChecksum && !matchesPreCursorChecksum) {
      return null
    }
  }
  return record
}

function decodeBinding(bindingJson: unknown, runtimeEpoch: unknown): TerminalRuntimeBinding | null {
  if (bindingJson === null && runtimeEpoch === null) {
    return null
  }
  const value = parseJsonObject(bindingJson)
  if (
    !value ||
    typeof value.sessionId !== 'string' ||
    typeof value.runtimeEpoch !== 'string' ||
    value.runtimeEpoch !== runtimeEpoch ||
    !isRuntimeRoute(value.route)
  ) {
    return null
  }
  return {
    sessionId: value.sessionId,
    runtimeEpoch: value.runtimeEpoch,
    route: value.route,
  }
}

function decodePresentation(row: RecoveryRow): {
  archivedEpochs: TerminalArchivedEpoch[]
  historyTruncated: boolean
  checkpoint: TerminalPresentationCheckpoint | null
} | null {
  if (row.presentation_json === null) {
    return row.checkpoint_revision === 0 && row.applied_seq === 0
      ? { archivedEpochs: [], historyTruncated: false, checkpoint: null }
      : null
  }
  const value = parseJsonObject(row.presentation_json)
  if (!value) {
    return null
  }
  const archivedEpochs = decodeArchivedEpochs(value.archivedEpochs)
  if (!archivedEpochs) {
    return null
  }
  if (value.historyTruncated !== undefined && typeof value.historyTruncated !== 'boolean') {
    return null
  }
  const historyTruncated = value.historyTruncated === true
  const hasCheckpoint = typeof value.serializedScreen === 'string'
  if (!hasCheckpoint) {
    return row.checkpoint_revision === 0 && row.applied_seq === 0
      ? { archivedEpochs, historyTruncated, checkpoint: null }
      : null
  }
  const checkpoint = decodeCheckpointValue(value, row)
  return checkpoint ? { archivedEpochs, historyTruncated, checkpoint } : null
}

function decodeCheckpointValue(
  value: Record<string, unknown>,
  row: RecoveryRow,
): TerminalPresentationCheckpoint | null {
  const downstreamReplayCursor =
    value.downstreamReplayCursor === undefined || value.downstreamReplayCursor === null
      ? null
      : isNonNegativeInteger(value.downstreamReplayCursor)
        ? value.downstreamReplayCursor
        : undefined
  if (
    !isNonNegativeInteger(row.checkpoint_revision) ||
    !isNonNegativeInteger(row.applied_seq) ||
    !isNonNegativeInteger(value.presentationRevision) ||
    !isPositiveInteger(value.cols) ||
    !isPositiveInteger(value.rows) ||
    !(value.geometryRevision === null || isNonNegativeInteger(value.geometryRevision)) ||
    (value.bufferKind !== 'normal' &&
      value.bufferKind !== 'alternate' &&
      value.bufferKind !== 'unknown') ||
    !isCursor(value.cursor) ||
    !(value.title === null || typeof value.title === 'string') ||
    typeof value.serializedScreen !== 'string' ||
    downstreamReplayCursor === undefined
  ) {
    return null
  }
  return {
    checkpointRevision: row.checkpoint_revision,
    appliedSeq: row.applied_seq,
    presentationRevision: value.presentationRevision,
    cols: value.cols,
    rows: value.rows,
    geometryRevision: value.geometryRevision,
    bufferKind: value.bufferKind,
    cursor: value.cursor,
    title: value.title,
    serializedScreen: value.serializedScreen,
    downstreamReplayCursor,
  }
}

function decodeArchivedEpochs(value: unknown): TerminalArchivedEpoch[] | null {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const epochs: TerminalArchivedEpoch[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null
    }
    const epoch = candidate as Record<string, unknown>
    if (
      typeof epoch.runtimeEpoch !== 'string' ||
      !isPositiveInteger(epoch.cols) ||
      !isPositiveInteger(epoch.rows) ||
      (epoch.bufferKind !== 'normal' &&
        epoch.bufferKind !== 'alternate' &&
        epoch.bufferKind !== 'unknown') ||
      typeof epoch.serializedScreen !== 'string'
    ) {
      return null
    }
    epochs.push({
      runtimeEpoch: epoch.runtimeEpoch,
      cols: epoch.cols,
      rows: epoch.rows,
      bufferKind: epoch.bufferKind,
      serializedScreen: epoch.serializedScreen,
    })
  }
  return epochs
}

function isRuntimeRoute(value: unknown): value is TerminalRuntimeBinding['route'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const route = value as Record<string, unknown>
  if (route.kind === 'local') {
    return route.workerInstanceId === null || typeof route.workerInstanceId === 'string'
  }
  return (
    route.kind === 'remote' &&
    (route.homeWorkerInstanceId === null || typeof route.homeWorkerInstanceId === 'string') &&
    typeof route.endpointId === 'string' &&
    typeof route.remoteSessionId === 'string' &&
    (route.targetWorkerInstanceId === null || typeof route.targetWorkerInstanceId === 'string')
  )
}

function isCursor(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const cursor = value as Record<string, unknown>
  return isNonNegativeInteger(cursor.x) && isNonNegativeInteger(cursor.y)
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function encodePresentationEnvelope(record: TerminalRecoveryRecord): string | null {
  if (!record.checkpoint && record.archivedEpochs.length === 0 && !record.historyTruncated) {
    return null
  }
  return JSON.stringify({
    ...(record.checkpoint ?? {}),
    archivedEpochs: record.archivedEpochs,
    historyTruncated: record.historyTruncated,
  })
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function invalidNode(): TerminalRecoveryMutationResult {
  return { ok: false, reason: 'invalid_node' }
}
