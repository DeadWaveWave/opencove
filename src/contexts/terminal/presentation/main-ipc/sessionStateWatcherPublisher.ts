import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import type { OwnedSessionStateWatcherInput } from './sessionStateWatcherInput'
import { logSessionStateWatcherDiagnostics } from './sessionStateWatcherShared'

/** Publishes current watcher evidence through the Worker observation port. */
export function createSessionStatePublisher({
  getInput,
  onState,
}: {
  getInput: (sessionId: string) => OwnedSessionStateWatcherInput | undefined
  onState?: (event: TerminalSessionStateEvent) => void
}) {
  return (
    sessionId: string,
    state: 'working' | 'waiting' | 'standby',
    options: {
      degraded?: boolean
      source?: TerminalSessionStateEvent['source']
      hookEventName?: string
      baseline?: boolean
    } = {},
  ): void => {
    if (getInput(sessionId)?.discovery?.isCurrent() === false) {
      return
    }
    const eventPayload: TerminalSessionStateEvent = {
      agentProvider: getInput(sessionId)?.provider,
      hookEventName: options.hookEventName,
      ...(options.baseline === true ? { baseline: true } : {}),
      sessionId,
      state,
      source: options.source ?? 'session_file',
      ...(options.degraded === true ? { degraded: true } : {}),
    }
    logSessionStateWatcherDiagnostics('broadcast-state', {
      sessionId,
      state,
    })
    onState?.(eventPayload)
  }
}
