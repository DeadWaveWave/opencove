import type {
  AgentLaunchMode,
  AgentProviderId,
  TerminalSessionState,
} from '../../../../shared/contracts/dto'
import { GeminiSessionStateWatcher } from '../../../agent/infrastructure/watchers/GeminiSessionStateWatcher'
import { KimiWireStateWatcher } from '../../../agent/infrastructure/watchers/KimiWireStateWatcher'
import type { KimiWireUnobservableReason } from '../../../agent/infrastructure/watchers/KimiWireStateDetector'
import { SessionTurnStateWatcher } from '../../../agent/infrastructure/watchers/SessionTurnStateWatcher'
import { isJsonlProvider, logSessionStateWatcherDiagnostics } from './sessionStateWatcherShared'

export function createSessionFileStateWatcher(options: {
  provider: AgentProviderId
  sessionId: string
  filePath: string
  launchMode: AgentLaunchMode
  onState: (sessionId: string, state: TerminalSessionState) => void
  onUnavailable: (sessionId: string) => void
  onError: (error: unknown) => void
}): { dispose: () => void; start: () => void; noteInteraction?: (data?: string) => void } {
  if (isJsonlProvider(options.provider)) {
    return new SessionTurnStateWatcher({
      provider: options.provider,
      sessionId: options.sessionId,
      filePath: options.filePath,
      onState: options.onState,
      onError: options.onError,
    })
  }
  if (options.provider === 'kimi') {
    return new KimiWireStateWatcher({
      sessionId: options.sessionId,
      filePath: options.filePath,
      onState: options.onState,
      onUnavailable: (sessionId, reason: KimiWireUnobservableReason) => {
        logSessionStateWatcherDiagnostics('kimi-wire-unavailable', { sessionId, reason })
        options.onUnavailable(sessionId)
      },
      onError: options.onError,
    })
  }
  return new GeminiSessionStateWatcher({
    sessionId: options.sessionId,
    filePath: options.filePath,
    launchMode: options.launchMode,
    onState: options.onState,
    onError: options.onError,
  })
}
