import type { Terminal } from '@xterm/xterm'

type GateListener = () => void

type TerminalGeometryCoordinatorState = {
  nextRevision: number
  pendingRevision: number | null
  acceptedRevision: number | null
  listeners: Set<GateListener>
}

const terminalGeometryStates = new WeakMap<Terminal, TerminalGeometryCoordinatorState>()

function getTerminalGeometryState(terminal: Terminal): TerminalGeometryCoordinatorState {
  const existing = terminalGeometryStates.get(terminal)
  if (existing) {
    return existing
  }

  const created: TerminalGeometryCoordinatorState = {
    nextRevision: 0,
    pendingRevision: null,
    acceptedRevision: null,
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
  return state.pendingRevision
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
  const previousPendingRevision = state.pendingRevision

  if (acceptedRevision !== null) {
    if (state.acceptedRevision !== null && acceptedRevision < state.acceptedRevision) {
      return
    }

    state.acceptedRevision = acceptedRevision
    state.nextRevision = Math.max(state.nextRevision, acceptedRevision)
    if (state.pendingRevision !== null && acceptedRevision >= state.pendingRevision) {
      state.pendingRevision = null
    }
  } else {
    state.pendingRevision = null
  }

  if (previousPendingRevision !== null && state.pendingRevision === null) {
    notifyGateListeners(state)
  }
}

export function markTerminalGeometryCommitSettled(
  terminal: Terminal,
  geometryRevision: number,
): void {
  if (!isTerminalGeometryCommitCurrent(terminal, geometryRevision)) {
    return
  }

  markTerminalGeometryAccepted(terminal, geometryRevision)
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
