import { isAgentHookStateSource } from '../../../../shared/runtime/agentHookStateSource'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import type { SessionState } from './ptyStreamState'

export function registerPtyStreamAgentState(options: {
  session: SessionState
  event: TerminalSessionStateEvent
  now: () => number
  broadcast: (event: TerminalSessionStateEvent) => void
}): void {
  if (options.session.status === 'exited') {
    return
  }
  const source = options.event.source ?? 'session_file'
  const previous = options.session.agentStateBySource.get(source)
  if (
    !isAgentHookStateSource(source) &&
    previous?.state === options.event.state &&
    previous.hookInstallState === options.event.hookInstallState &&
    previous.observationUnavailable === options.event.observationUnavailable &&
    previous.piConversation?.pid === options.event.piConversation?.pid &&
    previous.piConversation?.revision === options.event.piConversation?.revision
  ) {
    return
  }

  const observedAtMs =
    typeof options.event.observedAtMs === 'number' && Number.isFinite(options.event.observedAtMs)
      ? options.event.observedAtMs
      : options.now()
  const event: TerminalSessionStateEvent = {
    ...options.event,
    source,
    observedAtMs,
  }
  options.session.agentStateBySource.set(source, event)
  options.broadcast(event)
}
