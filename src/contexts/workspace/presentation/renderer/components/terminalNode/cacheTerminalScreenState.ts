import type { CommittedTerminalScreenState } from './committedScreenState'
import { setCachedTerminalScreenState } from './screenStateCache'

export function cacheTerminalScreenStateOnUnmount({
  nodeId,
  isInvalidated,
  isTerminalHydrated,
  hasPendingWrites,
  rawSnapshot,
  resolveCommittedScreenState,
}: {
  nodeId: string
  isInvalidated: boolean
  isTerminalHydrated: boolean
  hasPendingWrites: boolean
  rawSnapshot: string
  resolveCommittedScreenState: (
    rawSnapshot: string,
    options?: { allowSerializeFallback?: boolean },
  ) => CommittedTerminalScreenState | null
}): void {
  if (isInvalidated || !isTerminalHydrated) {
    return
  }

  const latestCommittedScreenState = resolveCommittedScreenState(rawSnapshot, {
    allowSerializeFallback: !hasPendingWrites,
  })
  if (!latestCommittedScreenState) {
    return
  }

  setCachedTerminalScreenState(nodeId, {
    sessionId: latestCommittedScreenState.sessionId,
    serialized: latestCommittedScreenState.serialized,
    cols: latestCommittedScreenState.cols,
    rows: latestCommittedScreenState.rows,
  })
}
