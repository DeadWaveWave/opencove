import type {
  TerminalAgentActivityMetadata,
  TerminalSessionMetadataEvent,
} from '../../../../shared/contracts/dto'
import {
  isTerminalAgentActivityStrictlyNewer,
  normalizeTerminalAgentActivityMetadata,
} from '../../../../shared/runtime/terminalAgentActivity'
import type { TerminalAgentActivityApi } from './terminalAgentActivityApi'

type Unsubscribe = () => void

export interface TerminalAgentActivityMetadataSource {
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => Unsubscribe
  onExit?: (listener: (event: { sessionId: string }) => void) => Unsubscribe
}

export interface TerminalAgentActivityBaselineOwner {
  getLatestMetadata: (sessionId: string) => TerminalAgentActivityMetadata | null
  dispose: () => void
}

export function createTerminalAgentActivityBaselineOwner(options: {
  source: TerminalAgentActivityMetadataSource
  api: TerminalAgentActivityApi
  applyMetadata: (event: TerminalSessionMetadataEvent) => void
}): TerminalAgentActivityBaselineOwner {
  const latestBySessionId = new Map<string, TerminalAgentActivityMetadata>()
  const exitedSessionIds = new Set<string>()
  let disposed = false

  const rememberIfNewer = (event: TerminalAgentActivityMetadata): boolean => {
    const current = latestBySessionId.get(event.sessionId)
    if (
      current &&
      !isTerminalAgentActivityStrictlyNewer(
        event.terminalAgentActivity,
        current.terminalAgentActivity,
      )
    ) {
      return false
    }
    latestBySessionId.set(event.sessionId, event)
    return true
  }

  const unsubscribe = options.source.onMetadata(event => {
    if (disposed || exitedSessionIds.has(event.sessionId)) {
      return
    }
    const activity = normalizeTerminalAgentActivityMetadata(event)
    if (activity && !rememberIfNewer(activity)) {
      return
    }
    options.applyMetadata(event)
  })
  const unsubscribeExit =
    options.source.onExit?.(event => {
      exitedSessionIds.add(event.sessionId)
      latestBySessionId.delete(event.sessionId)
    }) ?? (() => undefined)

  void options.api
    .listLatestMetadata()
    .then(entries => {
      if (disposed) {
        return
      }
      entries.forEach(entry => {
        if (disposed || exitedSessionIds.has(entry.sessionId) || !rememberIfNewer(entry)) {
          return
        }
        options.applyMetadata(entry)
      })
    })
    .catch(() => undefined)

  return {
    getLatestMetadata: sessionId => {
      const entry = latestBySessionId.get(sessionId)
      return entry ? { ...entry, terminalAgentActivity: { ...entry.terminalAgentActivity } } : null
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      unsubscribe()
      unsubscribeExit()
      latestBySessionId.clear()
      exitedSessionIds.clear()
    },
  }
}
