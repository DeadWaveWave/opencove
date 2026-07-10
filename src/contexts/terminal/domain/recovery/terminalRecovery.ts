export const TERMINAL_RECOVERY_FORMAT_VERSION = 1 as const

export type TerminalBufferKind = 'normal' | 'alternate' | 'unknown'

export type TerminalRuntimeRoute =
  | {
      kind: 'local'
      workerInstanceId: string | null
    }
  | {
      kind: 'remote'
      homeWorkerInstanceId: string | null
      endpointId: string
      remoteSessionId: string
      targetWorkerInstanceId: string | null
    }

export type TerminalRuntimeBinding = {
  sessionId: string
  runtimeEpoch: string
  route: TerminalRuntimeRoute
}

export type TerminalCursor = {
  x: number
  y: number
}

export type TerminalPresentationSnapshot = {
  appliedSeq: number
  presentationRevision: number
  cols: number
  rows: number
  geometryRevision: number | null
  bufferKind: TerminalBufferKind
  cursor: TerminalCursor
  title: string | null
  serializedScreen: string
  /** Downstream Worker replay sequence covered by this snapshot, for surviving remote PTYs. */
  downstreamReplayCursor?: number | null
}

export type TerminalPresentationCheckpoint = TerminalPresentationSnapshot & {
  checkpointRevision: number
}

export type TerminalArchivedEpoch = {
  runtimeEpoch: string
  cols: number
  rows: number
  bufferKind: TerminalBufferKind
  serializedScreen: string
}

export type TerminalRecoveryRecord = {
  nodeId: string
  formatVersion: typeof TERMINAL_RECOVERY_FORMAT_VERSION
  generation: number
  binding: TerminalRuntimeBinding | null
  archivedEpochs: TerminalArchivedEpoch[]
  historyTruncated: boolean
  checkpoint: TerminalPresentationCheckpoint | null
  rawTail: string
  rawTruncated: boolean
  checksum: string | null
  updatedAt: string
}

export type TerminalRecoveryMutationFailureReason =
  | 'missing_record'
  | 'invalid_node'
  | 'stale_generation'
  | 'binding_conflict'
  | 'binding_mismatch'
  | 'stale_checkpoint'

export type TerminalRecoveryMutationResult =
  | {
      ok: true
      changed: boolean
      record: TerminalRecoveryRecord
    }
  | {
      ok: false
      reason: TerminalRecoveryMutationFailureReason
    }

type ReserveTerminalRecoveryRecordInput = {
  current: TerminalRecoveryRecord | null
  nodeId: string
  generation: number
  now: string
}

type BindTerminalRecoveryRecordInput = {
  current: TerminalRecoveryRecord | null
  nodeId: string
  generation: number
  binding: TerminalRuntimeBinding
  now: string
}

export type CommitTerminalRecoveryRecordInput = {
  current: TerminalRecoveryRecord | null
  nodeId: string
  generation: number
  binding: TerminalRuntimeBinding
  checkpoint: TerminalPresentationCheckpoint
  rawTail: string
  rawTruncated: boolean
  checksum: string | null
  now: string
}

export function reserveTerminalRecoveryRecord(
  input: ReserveTerminalRecoveryRecordInput,
): TerminalRecoveryMutationResult {
  if (!input.current) {
    return changed({
      nodeId: input.nodeId,
      formatVersion: TERMINAL_RECOVERY_FORMAT_VERSION,
      generation: input.generation,
      binding: null,
      archivedEpochs: [],
      historyTruncated: false,
      checkpoint: null,
      rawTail: '',
      rawTruncated: false,
      checksum: null,
      updatedAt: input.now,
    })
  }
  if (input.generation < input.current.generation) {
    return failed('stale_generation')
  }
  if (input.generation === input.current.generation) {
    return unchanged(input.current)
  }
  const archived = archiveCurrentEpoch(input.current)
  return changed({
    ...input.current,
    generation: input.generation,
    binding: null,
    archivedEpochs: archived.epochs,
    historyTruncated: input.current.historyTruncated || archived.truncated,
    checkpoint: null,
    rawTail: '',
    rawTruncated: false,
    checksum: null,
    updatedAt: input.now,
  })
}

export function bindTerminalRecoveryRecord(
  input: BindTerminalRecoveryRecordInput,
): TerminalRecoveryMutationResult {
  if (!input.current) {
    return failed('missing_record')
  }
  if (input.generation !== input.current.generation) {
    return failed('stale_generation')
  }
  if (input.current.binding) {
    if (sameBinding(input.current.binding, input.binding)) {
      return unchanged(input.current)
    }
    if (sameDurableRuntimeEpoch(input.current.binding, input.binding)) {
      return changed({
        ...input.current,
        binding: input.binding,
        updatedAt: input.now,
      })
    }
    return failed('binding_conflict')
  }
  return changed({
    ...input.current,
    binding: input.binding,
    updatedAt: input.now,
  })
}

const ALT_BUFFER_ENTER_MARKER = '\u001b[?1049h'
const ALT_BUFFER_EXIT_MARKER = '\u001b[?1049l'
const ARCHIVED_EPOCH_MAX_CHARS = 400_000
const ARCHIVED_EPOCH_MAX_ROWS = 200
const ARCHIVED_EPOCH_MODE_RESET = [
  '\u001b[?1049l',
  '\u001b[!p',
  '\u001b[?1l',
  '\u001b[?66l',
  '\u001b[?2004l',
  '\u001b[4l',
  '\u001b[?6l',
  '\u001b[?45l',
  '\u001b[?1004l',
  '\u001b[?2026l',
  '\u001b[?7h',
  '\u001b[?9l',
  '\u001b[?1000l',
  '\u001b[?1002l',
  '\u001b[?1003l',
  '\u001b[?1005l',
  '\u001b[?1006l',
  '\u001b[?1015l',
  '\u001b[?1016l',
  '\u001b[?25h',
  '\u001b[0m',
].join('')

/**
 * Builds the renderer baseline without merging runtime state across epochs. Archived checkpoints
 * are converted into inert scrollback previews; only the latest checkpoint is allowed to restore
 * terminal modes and the active screen.
 */
export function composeTerminalRecoveryScrollback(record: TerminalRecoveryRecord): string {
  const archivedHistory = record.archivedEpochs.map(renderArchivedEpoch).join('')
  const latestPresentation = resolveCurrentEpochPresentation(record)
  return `${archivedHistory}${latestPresentation}`
}

function archiveCurrentEpoch(record: TerminalRecoveryRecord): {
  epochs: TerminalArchivedEpoch[]
  truncated: boolean
} {
  const serializedScreen = resolveCurrentEpochPresentation(record)
  if (serializedScreen.length === 0) {
    return { epochs: record.archivedEpochs, truncated: false }
  }

  const checkpoint = record.checkpoint
  const nextEpoch: TerminalArchivedEpoch = {
    runtimeEpoch: record.binding?.runtimeEpoch ?? `legacy:${record.generation}`,
    cols: checkpoint?.cols ?? 80,
    rows: checkpoint?.rows ?? 24,
    bufferKind: checkpoint?.bufferKind ?? 'unknown',
    serializedScreen,
  }
  const epochs = [...record.archivedEpochs, nextEpoch]
  let totalChars = epochs.reduce((total, epoch) => total + epoch.serializedScreen.length, 0)
  let truncated = false
  // Epochs are indivisible ANSI envelopes. Evict complete oldest envelopes until the strict
  // bound is met; an individually oversized envelope is omitted rather than sliced mid-sequence.
  while (epochs.length > 0 && totalChars > ARCHIVED_EPOCH_MAX_CHARS) {
    const removed = epochs.shift()
    totalChars -= removed?.serializedScreen.length ?? 0
    truncated = true
  }
  return {
    epochs,
    truncated: truncated || (!record.checkpoint && record.rawTruncated),
  }
}

function resolveCurrentEpochPresentation(record: TerminalRecoveryRecord): string {
  const serializedScreen = record.checkpoint?.serializedScreen ?? ''
  return serializedScreen.length > 0 ? serializedScreen : record.rawTail
}

function renderArchivedEpoch(epoch: TerminalArchivedEpoch): string {
  const leavesAlternateScreenActive =
    epoch.bufferKind === 'alternate' ||
    epoch.serializedScreen.lastIndexOf(ALT_BUFFER_ENTER_MARKER) >
      epoch.serializedScreen.lastIndexOf(ALT_BUFFER_EXIT_MARKER)
  const staticPreview = leavesAlternateScreenActive
    ? epoch.serializedScreen.split(ALT_BUFFER_ENTER_MARKER).join(ALT_BUFFER_EXIT_MARKER)
    : epoch.serializedScreen
  const rows = Math.max(1, Math.min(ARCHIVED_EPOCH_MAX_ROWS, Math.floor(epoch.rows)))
  return `${staticPreview}${ARCHIVED_EPOCH_MODE_RESET}${'\r\n'.repeat(rows)}`
}

export function commitTerminalRecoveryRecord(
  input: CommitTerminalRecoveryRecordInput,
): TerminalRecoveryMutationResult {
  if (!input.current) {
    return failed('missing_record')
  }
  if (input.generation !== input.current.generation) {
    return failed('stale_generation')
  }
  if (!input.current.binding || !sameBinding(input.current.binding, input.binding)) {
    return failed('binding_mismatch')
  }
  if (
    input.current.checkpoint &&
    input.checkpoint.checkpointRevision <= input.current.checkpoint.checkpointRevision
  ) {
    return failed('stale_checkpoint')
  }
  return changed({
    ...input.current,
    checkpoint: input.checkpoint,
    rawTail: input.rawTail,
    rawTruncated: input.rawTruncated,
    checksum: input.checksum,
    updatedAt: input.now,
  })
}

function sameBinding(left: TerminalRuntimeBinding, right: TerminalRuntimeBinding): boolean {
  if (left.sessionId !== right.sessionId || left.runtimeEpoch !== right.runtimeEpoch) {
    return false
  }
  if (left.route.kind !== right.route.kind) {
    return false
  }
  if (left.route.kind === 'local' && right.route.kind === 'local') {
    return left.route.workerInstanceId === right.route.workerInstanceId
  }
  if (left.route.kind === 'remote' && right.route.kind === 'remote') {
    return (
      left.route.homeWorkerInstanceId === right.route.homeWorkerInstanceId &&
      left.route.endpointId === right.route.endpointId &&
      left.route.remoteSessionId === right.route.remoteSessionId &&
      left.route.targetWorkerInstanceId === right.route.targetWorkerInstanceId
    )
  }
  return false
}

/**
 * Home Worker identity is transport locality, not remote PTY epoch identity. A surviving remote
 * Worker/session may therefore refresh its Home route without reserving or archiving a generation.
 */
export function sameDurableRuntimeEpoch(
  left: TerminalRuntimeBinding,
  right: TerminalRuntimeBinding,
): boolean {
  if (left.sessionId !== right.sessionId || left.runtimeEpoch !== right.runtimeEpoch) {
    return false
  }
  return routesShareDurableRuntimeEpoch(left.route, right.route)
}

export function routesShareDurableRuntimeEpoch(
  left: TerminalRuntimeRoute,
  right: TerminalRuntimeRoute,
): boolean {
  if (left.kind === 'local' && right.kind === 'local') {
    return left.workerInstanceId === right.workerInstanceId
  }
  if (left.kind === 'remote' && right.kind === 'remote') {
    return (
      left.endpointId === right.endpointId &&
      left.remoteSessionId === right.remoteSessionId &&
      left.targetWorkerInstanceId === right.targetWorkerInstanceId
    )
  }
  return false
}

function changed(record: TerminalRecoveryRecord): TerminalRecoveryMutationResult {
  return { ok: true, changed: true, record }
}

function unchanged(record: TerminalRecoveryRecord): TerminalRecoveryMutationResult {
  return { ok: true, changed: false, record }
}

function failed(reason: TerminalRecoveryMutationFailureReason): TerminalRecoveryMutationResult {
  return { ok: false, reason }
}
