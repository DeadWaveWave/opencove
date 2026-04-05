const GUARD_TTL_MS = 1_250

const guardedUntilByNodeId = new Map<string, number>()

function normalizeNodeId(nodeId: string): string {
  return nodeId.trim()
}

function pruneExpiredGuards(nowMs: number): void {
  for (const [nodeId, untilMs] of guardedUntilByNodeId.entries()) {
    if (untilMs <= nowMs) {
      guardedUntilByNodeId.delete(nodeId)
    }
  }
}

export function guardNodeFromSyncOverwrite(nodeId: string, ttlMs = GUARD_TTL_MS): void {
  const normalizedNodeId = normalizeNodeId(nodeId)
  if (normalizedNodeId.length === 0) {
    return
  }

  const resolvedTtlMs = Math.max(0, Math.floor(ttlMs))
  const nowMs = Date.now()
  const untilMs = nowMs + resolvedTtlMs

  pruneExpiredGuards(nowMs)

  const currentUntilMs = guardedUntilByNodeId.get(normalizedNodeId) ?? 0
  if (untilMs <= currentUntilMs) {
    return
  }

  guardedUntilByNodeId.set(normalizedNodeId, untilMs)
}

export function isNodeGuardedFromSyncOverwrite(nodeId: string): boolean {
  const normalizedNodeId = normalizeNodeId(nodeId)
  if (normalizedNodeId.length === 0) {
    return false
  }

  const untilMs = guardedUntilByNodeId.get(normalizedNodeId) ?? null
  if (untilMs === null) {
    return false
  }

  const nowMs = Date.now()
  if (untilMs <= nowMs) {
    guardedUntilByNodeId.delete(normalizedNodeId)
    pruneExpiredGuards(nowMs)
    return false
  }

  return true
}
