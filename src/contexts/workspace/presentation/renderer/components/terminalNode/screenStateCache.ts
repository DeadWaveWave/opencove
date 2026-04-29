export interface CachedTerminalScreenState {
  sessionId: string
  serialized: string
  cols: number
  rows: number
}

const screenStateByNodeId = new Map<string, CachedTerminalScreenState>()
const invalidatedSessionIdByNodeId = new Map<string, string>()

function normalizeId(value: string): string {
  return value.trim()
}

function normalizeDimension(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

export function getCachedTerminalScreenState(
  nodeId: string,
  sessionId: string,
): CachedTerminalScreenState | null {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(sessionId)

  if (normalizedNodeId.length === 0 || normalizedSessionId.length === 0) {
    return null
  }

  if (invalidatedSessionIdByNodeId.get(normalizedNodeId) === normalizedSessionId) {
    return null
  }

  const cached = screenStateByNodeId.get(normalizedNodeId)
  if (!cached || cached.sessionId !== normalizedSessionId) {
    return null
  }

  return cached
}

export function peekCachedTerminalScreenState(nodeId: string): CachedTerminalScreenState | null {
  const normalizedNodeId = normalizeId(nodeId)
  if (normalizedNodeId.length === 0) {
    return null
  }

  return screenStateByNodeId.get(normalizedNodeId) ?? null
}

export function setCachedTerminalScreenState(
  nodeId: string,
  state: CachedTerminalScreenState,
): void {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(state.sessionId)

  if (
    normalizedNodeId.length === 0 ||
    normalizedSessionId.length === 0 ||
    state.serialized.length === 0
  ) {
    return
  }

  if (invalidatedSessionIdByNodeId.get(normalizedNodeId) === normalizedSessionId) {
    invalidatedSessionIdByNodeId.delete(normalizedNodeId)
    return
  }

  invalidatedSessionIdByNodeId.delete(normalizedNodeId)
  screenStateByNodeId.set(normalizedNodeId, {
    sessionId: normalizedSessionId,
    serialized: state.serialized,
    cols: normalizeDimension(state.cols, 80),
    rows: normalizeDimension(state.rows, 24),
  })
}

export function removeCachedTerminalScreenState(nodeId: string, sessionId: string): void {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(sessionId)

  if (normalizedNodeId.length === 0 || normalizedSessionId.length === 0) {
    return
  }

  const cached = screenStateByNodeId.get(normalizedNodeId)
  if (cached?.sessionId === normalizedSessionId) {
    screenStateByNodeId.delete(normalizedNodeId)
  }

  if (invalidatedSessionIdByNodeId.get(normalizedNodeId) === normalizedSessionId) {
    invalidatedSessionIdByNodeId.delete(normalizedNodeId)
  }
}

export function invalidateCachedTerminalScreenState(nodeId: string, sessionId: string): void {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(sessionId)

  if (normalizedNodeId.length === 0 || normalizedSessionId.length === 0) {
    return
  }

  screenStateByNodeId.delete(normalizedNodeId)
  invalidatedSessionIdByNodeId.set(normalizedNodeId, normalizedSessionId)
}

export function isCachedTerminalScreenStateInvalidated(nodeId: string, sessionId: string): boolean {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(sessionId)

  if (normalizedNodeId.length === 0 || normalizedSessionId.length === 0) {
    return false
  }

  return invalidatedSessionIdByNodeId.get(normalizedNodeId) === normalizedSessionId
}

export function clearCachedTerminalScreenStateInvalidation(
  nodeId: string,
  sessionId: string,
): void {
  const normalizedNodeId = normalizeId(nodeId)
  const normalizedSessionId = normalizeId(sessionId)

  if (normalizedNodeId.length === 0 || normalizedSessionId.length === 0) {
    return
  }

  if (invalidatedSessionIdByNodeId.get(normalizedNodeId) !== normalizedSessionId) {
    return
  }

  invalidatedSessionIdByNodeId.delete(normalizedNodeId)
}

export function clearCachedTerminalScreenStates(): void {
  screenStateByNodeId.clear()
  invalidatedSessionIdByNodeId.clear()
}
