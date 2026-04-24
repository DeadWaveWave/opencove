import { useScrollbackStore } from '../store/useScrollbackStore'
import { invalidateCachedTerminalScreenState } from '../components/terminalNode/screenStateCache'
import { clearScheduledScrollbackWrites } from './persistence/scrollbackSchedule'

export function cleanupNodeRuntimeArtifacts(nodeId: string, sessionId: string): void {
  const normalizedSessionId = sessionId.trim()

  if (normalizedSessionId.length > 0) {
    invalidateCachedTerminalScreenState(nodeId, normalizedSessionId)
  }

  useScrollbackStore.getState().clearNodeScrollback(nodeId)
  clearScheduledScrollbackWrites(nodeId)
}
