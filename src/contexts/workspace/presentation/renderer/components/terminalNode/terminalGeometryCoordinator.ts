import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitResult } from '@shared/contracts/dto'

type GateListener = () => void

type TerminalGeometryCoordinatorState = {
  nextRevision: number
  pendingRevision: number | null
  pendingOperationId: string | null
  acceptedRevision: number | null
  authorityEpoch: number | null
  listeners: Set<GateListener>
}

const terminalGeometryStates = new WeakMap<Terminal, TerminalGeometryCoordinatorState>()
let nextGeometryOperationId = 0

function getTerminalGeometryState(terminal: Terminal): TerminalGeometryCoordinatorState {
  const existing = terminalGeometryStates.get(terminal)
  if (existing) {
    return existing
  }

  const created: TerminalGeometryCoordinatorState = {
    nextRevision: 0,
    pendingRevision: null,
    pendingOperationId: null,
    acceptedRevision: null,
    authorityEpoch: null,
    listeners: new Set(),
  }
  terminalGeometryStates.set(terminal, created)
  return created
}

function notifyGateListeners(state: TerminalGeometryCoordinatorState): void {
  state.listeners.forEach(listener => {
    listener()
  })
}

function normalizeGeometryRevision(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

export function beginTerminalGeometryCommit(terminal: Terminal): number {
  const state = getTerminalGeometryState(terminal)
  state.nextRevision += 1
  state.pendingRevision = state.nextRevision
  nextGeometryOperationId += 1
  state.pendingOperationId = `renderer-geometry-${nextGeometryOperationId}-${state.nextRevision}`
  return state.pendingRevision
}

export function getTerminalGeometryCommitRequest(
  terminal: Terminal,
  geometryRevision: number,
): {
  operationId: string
  baseGeometryRevision: number | null
  authorityEpoch: number | null
} | null {
  const state = getTerminalGeometryState(terminal)
  if (state.pendingRevision !== geometryRevision || !state.pendingOperationId) {
    return null
  }

  return {
    operationId: state.pendingOperationId,
    baseGeometryRevision: state.acceptedRevision,
    authorityEpoch: state.authorityEpoch,
  }
}

export function isTerminalGeometryCommitCurrent(
  terminal: Terminal,
  geometryRevision: number,
): boolean {
  const state = getTerminalGeometryState(terminal)
  return state.pendingRevision === geometryRevision
}

export function markTerminalGeometryAccepted(
  terminal: Terminal,
  geometryRevision?: number | null,
): void {
  const state = getTerminalGeometryState(terminal)
  const acceptedRevision = normalizeGeometryRevision(geometryRevision)

  if (acceptedRevision !== null) {
    if (state.acceptedRevision !== null && acceptedRevision < state.acceptedRevision) {
      return
    }

    state.acceptedRevision = acceptedRevision
  }
}

export function resetTerminalGeometryRevisionDomain(terminal: Terminal): void {
  const state = getTerminalGeometryState(terminal)
  const hadPendingCommit = state.pendingRevision !== null
  state.pendingRevision = null
  state.pendingOperationId = null
  state.acceptedRevision = null
  state.authorityEpoch = null
  if (hadPendingCommit) {
    notifyGateListeners(state)
  }
}

export function recordTerminalGeometryCommitResult(
  terminal: Terminal,
  geometryRevision: number,
  result: TerminalGeometryCommitResult,
): boolean {
  const state = getTerminalGeometryState(terminal)
  if (
    state.pendingRevision !== geometryRevision ||
    !state.pendingOperationId ||
    result.operationId !== state.pendingOperationId
  ) {
    return false
  }

  const authorityEpoch = result.authority?.epoch
  const normalizedAuthorityEpoch =
    typeof authorityEpoch === 'number' && Number.isFinite(authorityEpoch) && authorityEpoch >= 0
      ? Math.floor(authorityEpoch)
      : null
  const authorityDomainChanged =
    normalizedAuthorityEpoch !== null && normalizedAuthorityEpoch !== state.authorityEpoch
  const acceptedRevision = normalizeGeometryRevision(result.geometry?.revision)
  if (
    result.geometry &&
    (acceptedRevision !== null || result.geometry.revision === null) &&
    (state.acceptedRevision === null ||
      (acceptedRevision !== null && acceptedRevision >= state.acceptedRevision) ||
      authorityDomainChanged)
  ) {
    state.acceptedRevision = acceptedRevision
  }

  if (normalizedAuthorityEpoch !== null) {
    state.authorityEpoch = normalizedAuthorityEpoch
  }

  return true
}

function settleTerminalGeometryCommit(terminal: Terminal, geometryRevision: number): void {
  const state = getTerminalGeometryState(terminal)
  if (state.pendingRevision !== geometryRevision) {
    return
  }

  state.pendingRevision = null
  state.pendingOperationId = null
  notifyGateListeners(state)
}

export function markTerminalGeometryCommitSettled(
  terminal: Terminal,
  geometryRevision: number,
): void {
  if (!isTerminalGeometryCommitCurrent(terminal, geometryRevision)) {
    return
  }

  settleTerminalGeometryCommit(terminal, geometryRevision)
}

export function canWriteTerminalOutput(terminal: Terminal): boolean {
  return getTerminalGeometryState(terminal).pendingRevision === null
}

export function subscribeTerminalGeometryWriteGate(
  terminal: Terminal,
  listener: GateListener,
): () => void {
  const state = getTerminalGeometryState(terminal)
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}
