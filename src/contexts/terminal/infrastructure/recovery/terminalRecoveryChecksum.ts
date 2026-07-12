import { createHash } from 'node:crypto'
import type {
  TerminalArchivedEpoch,
  TerminalPresentationCheckpoint,
  TerminalRecoveryRecord,
} from '../../domain/recovery/terminalRecovery'

export function recoveryChecksum(input: {
  archivedEpochs: TerminalArchivedEpoch[]
  historyTruncated: boolean
  checkpoint: TerminalPresentationCheckpoint | null
  rawTail: string
  rawTruncated: boolean
}): string {
  return hashRecoveryPayload({
    archivedEpochs: input.archivedEpochs,
    historyTruncated: input.historyTruncated,
    checkpoint: canonicalCheckpoint(input.checkpoint),
    rawTail: input.rawTail,
    rawTruncated: input.rawTruncated,
  })
}

export function legacyRecoveryChecksum(record: TerminalRecoveryRecord): string {
  return hashRecoveryPayload({
    checkpoint: canonicalCheckpointWithoutReplayCursor(record.checkpoint),
    rawTail: record.rawTail,
    rawTruncated: record.rawTruncated,
  })
}

/** Accepts checksums written by format-v1 builds before the downstream cursor was added. */
export function recoveryChecksumWithoutReplayCursor(record: TerminalRecoveryRecord): string {
  return hashRecoveryPayload({
    archivedEpochs: record.archivedEpochs,
    historyTruncated: record.historyTruncated,
    checkpoint: canonicalCheckpointWithoutReplayCursor(record.checkpoint),
    rawTail: record.rawTail,
    rawTruncated: record.rawTruncated,
  })
}

function canonicalCheckpoint(checkpoint: TerminalPresentationCheckpoint | null) {
  return checkpoint
    ? {
        checkpointRevision: checkpoint.checkpointRevision,
        appliedSeq: checkpoint.appliedSeq,
        presentationRevision: checkpoint.presentationRevision,
        cols: checkpoint.cols,
        rows: checkpoint.rows,
        geometryRevision: checkpoint.geometryRevision,
        bufferKind: checkpoint.bufferKind,
        cursor: { x: checkpoint.cursor.x, y: checkpoint.cursor.y },
        title: checkpoint.title,
        serializedScreen: checkpoint.serializedScreen,
        downstreamReplayCursor: checkpoint.downstreamReplayCursor ?? null,
      }
    : null
}

function canonicalCheckpointWithoutReplayCursor(checkpoint: TerminalPresentationCheckpoint | null) {
  const canonical = canonicalCheckpoint(checkpoint)
  if (!canonical) {
    return null
  }
  const { downstreamReplayCursor: _downstreamReplayCursor, ...legacy } = canonical
  void _downstreamReplayCursor
  return legacy
}

function hashRecoveryPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
