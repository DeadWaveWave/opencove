import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  AgentLaunchMode,
  AgentProviderId,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import {
  captureGeminiSessionDiscoveryCursor,
  type GeminiSessionDiscoveryCursor,
} from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import { GeminiSessionStateWatcher } from '../../../agent/infrastructure/watchers/GeminiSessionStateWatcher'
import { OpenCodeSessionStateWatcher } from '../../../agent/infrastructure/watchers/OpenCodeSessionStateWatcher'
import { resolveSessionFilePath } from '../../../agent/infrastructure/watchers/SessionFileResolver'
import { SessionTurnStateWatcher } from '../../../agent/infrastructure/watchers/SessionTurnStateWatcher'
import { resolveDiscoveredSessionId } from './sessionStateWatcherDiscovery'
import { shouldBroadcastOptimisticWorkingFromInteraction } from './sessionStateWatcherInteraction'

const SESSION_STATE_WATCHER_LOCATE_TIMEOUT_MS = 1_500
const SESSION_STATE_WATCHER_FILE_TIMEOUT_MS = 1_500
const SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS = 250
const SESSION_STATE_WATCHER_RETRY_MAX_DELAY_MS = 15_000
const SESSION_STATE_WATCHER_RETRY_MAX_IDLE_MS = 30 * 60_000

export interface SessionStateWatcherStartInput {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  launchMode: AgentLaunchMode
  resumeSessionId: string | null
  startedAtMs: number
  opencodeBaseUrl?: string | null
  /**
   * Optional pre-captured snapshot of Gemini sessions for this cwd.
   *
   * - `undefined`: controller will capture the snapshot itself (legacy behaviour).
   * - `null`: explicitly skip snapshot capture and attempt discovery without cursor filtering.
   */
  geminiDiscoveryCursor?: GeminiSessionDiscoveryCursor | null
}

type SendToAllWindows = <Payload>(channel: string, payload: Payload) => void
type DisposableSessionWatcher = { dispose: () => void; noteInteraction?: () => void }

function isJsonlProvider(provider: AgentProviderId): boolean {
  return provider === 'claude-code' || provider === 'codex'
}

export function createSessionStateWatcherController({
  sendToAllWindows,
  reportIssue,
}: {
  sendToAllWindows: SendToAllWindows
  reportIssue: (message: string) => void
}): {
  start: (input: SessionStateWatcherStartInput) => void
  noteInteraction: (sessionId: string, data?: string) => void
  disposeSession: (sessionId: string) => void
  dispose: () => void
} {
  const stateWatcherBySession = new Map<string, DisposableSessionWatcher>()
  const stateWatcherVersionBySession = new Map<string, number>()
  const stateWatcherStartInputBySession = new Map<string, SessionStateWatcherStartInput>()
  const stateWatcherLastInteractionAtMsBySession = new Map<string, number>()
  const stateWatcherResolvedResumeSessionIdBySession = new Map<string, string>()
  const stateWatcherRetryCountBySession = new Map<string, number>()
  const stateWatcherRetryTimerBySession = new Map<string, NodeJS.Timeout>()
  const stateWatcherStartingSessionIds = new Set<string>()
  const stateWatcherLastBroadcastResumeSessionIdBySession = new Map<string, string>()
  const geminiDiscoveryCursorBySession = new Map<string, GeminiSessionDiscoveryCursor>()
  const geminiDiscoveryCursorPendingSessionIds = new Set<string>()
  const stateWatcherPendingImmediateRetryBySession = new Set<string>()

  const bumpStateWatcherVersion = (sessionId: string): number => {
    const next = (stateWatcherVersionBySession.get(sessionId) ?? 0) + 1
    stateWatcherVersionBySession.set(sessionId, next)
    return next
  }

  const cancelSessionStateWatcherRetry = (sessionId: string): void => {
    const timer = stateWatcherRetryTimerBySession.get(sessionId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    stateWatcherRetryTimerBySession.delete(sessionId)
  }

  const resolveSessionStateWatcherRetryDelay = (attempt: number): number => {
    if (attempt <= 0) {
      return SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS
    }

    const delay = SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS * 2 ** attempt
    return Math.min(delay, SESSION_STATE_WATCHER_RETRY_MAX_DELAY_MS)
  }

  const broadcastSessionMetadata = (sessionId: string, resumeSessionId: string | null): void => {
    const eventPayload: TerminalSessionMetadataEvent = {
      sessionId,
      resumeSessionId,
    }
    sendToAllWindows(IPC_CHANNELS.ptySessionMetadata, eventPayload)
  }

  const clearSessionStateWatcher = (
    sessionId: string,
    options: { disposeStartInput?: boolean } = {},
  ): void => {
    bumpStateWatcherVersion(sessionId)
    cancelSessionStateWatcherRetry(sessionId)
    stateWatcherStartingSessionIds.delete(sessionId)

    const watcher = stateWatcherBySession.get(sessionId)
    if (watcher) {
      watcher.dispose()
      stateWatcherBySession.delete(sessionId)
    }

    if (options.disposeStartInput === true) {
      stateWatcherStartInputBySession.delete(sessionId)
      stateWatcherLastInteractionAtMsBySession.delete(sessionId)
      stateWatcherResolvedResumeSessionIdBySession.delete(sessionId)
      stateWatcherRetryCountBySession.delete(sessionId)
      stateWatcherLastBroadcastResumeSessionIdBySession.delete(sessionId)
      geminiDiscoveryCursorBySession.delete(sessionId)
      geminiDiscoveryCursorPendingSessionIds.delete(sessionId)
      stateWatcherPendingImmediateRetryBySession.delete(sessionId)
    }
  }

  const scheduleSessionStateWatcherAttempt = (
    sessionId: string,
    watcherVersion: number,
    delayMs: number,
  ): void => {
    cancelSessionStateWatcherRetry(sessionId)

    const input = stateWatcherStartInputBySession.get(sessionId)
    if (!input) {
      return
    }

    const lastInteractionAtMs = stateWatcherLastInteractionAtMsBySession.get(sessionId) ?? null
    const retryAnchorMs =
      typeof lastInteractionAtMs === 'number' ? lastInteractionAtMs : input.startedAtMs
    if (Date.now() - retryAnchorMs > SESSION_STATE_WATCHER_RETRY_MAX_IDLE_MS) {
      return
    }

    stateWatcherRetryTimerBySession.set(
      sessionId,
      setTimeout(() => {
        void attemptStartSessionStateWatcher(sessionId, watcherVersion)
      }, delayMs),
    )
  }

  const broadcastSessionMetadataOnce = (sessionId: string, resumeSessionId: string): void => {
    const previous = stateWatcherLastBroadcastResumeSessionIdBySession.get(sessionId) ?? null
    if (previous === resumeSessionId) {
      return
    }

    stateWatcherLastBroadcastResumeSessionIdBySession.set(sessionId, resumeSessionId)
    broadcastSessionMetadata(sessionId, resumeSessionId)
  }

  const broadcastSessionState = (sessionId: string, state: 'working' | 'standby'): void => {
    const eventPayload: TerminalSessionStateEvent = {
      sessionId,
      state,
    }
    sendToAllWindows(IPC_CHANNELS.ptyState, eventPayload)
  }

  const scheduleRetry = (sessionId: string, watcherVersion: number): void => {
    const attempt = stateWatcherRetryCountBySession.get(sessionId) ?? 0
    stateWatcherRetryCountBySession.set(sessionId, attempt + 1)
    scheduleSessionStateWatcherAttempt(
      sessionId,
      watcherVersion,
      resolveSessionStateWatcherRetryDelay(attempt),
    )
  }

  async function attemptStartSessionStateWatcher(
    sessionId: string,
    watcherVersion: number,
  ): Promise<void> {
    if (stateWatcherStartingSessionIds.has(sessionId) || stateWatcherBySession.has(sessionId)) {
      return
    }

    const input = stateWatcherStartInputBySession.get(sessionId)
    if (!input) {
      return
    }

    if ((stateWatcherVersionBySession.get(sessionId) ?? 0) !== watcherVersion) {
      return
    }

    stateWatcherStartingSessionIds.add(sessionId)

    try {
      const lastInteractionAtMs = stateWatcherLastInteractionAtMsBySession.get(sessionId) ?? null
      const startedAtHints = [
        ...(typeof lastInteractionAtMs === 'number' && lastInteractionAtMs !== input.startedAtMs
          ? [lastInteractionAtMs]
          : []),
        input.startedAtMs,
      ]

      const resolvedSessionId =
        input.resumeSessionId ??
        stateWatcherResolvedResumeSessionIdBySession.get(sessionId) ??
        (await resolveDiscoveredSessionId({
          sessionId,
          input,
          startedAtHints,
          geminiDiscoveryCursorBySession,
          locateTimeoutMs: SESSION_STATE_WATCHER_LOCATE_TIMEOUT_MS,
        }))

      if ((stateWatcherVersionBySession.get(sessionId) ?? 0) !== watcherVersion) {
        return
      }

      if (!resolvedSessionId) {
        if (stateWatcherPendingImmediateRetryBySession.delete(sessionId)) {
          stateWatcherRetryCountBySession.set(sessionId, 0)
          scheduleSessionStateWatcherAttempt(sessionId, watcherVersion, 0)
          return
        }

        scheduleRetry(sessionId, watcherVersion)
        return
      }

      stateWatcherResolvedResumeSessionIdBySession.set(sessionId, resolvedSessionId)
      broadcastSessionMetadataOnce(sessionId, resolvedSessionId)

      if (input.provider === 'opencode') {
        if (!input.opencodeBaseUrl) {
          reportIssue(`[cove] state watcher missing opencode baseUrl for session ${sessionId}`)
          return
        }

        const watcher = new OpenCodeSessionStateWatcher({
          sessionId,
          opencodeSessionId: resolvedSessionId,
          baseUrl: input.opencodeBaseUrl,
          cwd: input.cwd,
          launchMode: input.launchMode,
          onState: broadcastSessionState,
          onError: error => {
            const detail =
              error instanceof Error ? `${error.name}: ${error.message}` : 'unknown watcher error'
            reportIssue(
              `[cove] state watcher failed for ${input.provider} session ${sessionId}: ${detail}`,
            )
            clearSessionStateWatcher(sessionId)
            scheduleSessionStateWatcherAttempt(
              sessionId,
              stateWatcherVersionBySession.get(sessionId) ?? 0,
              resolveSessionStateWatcherRetryDelay(0),
            )
          },
        })

        if ((stateWatcherVersionBySession.get(sessionId) ?? 0) !== watcherVersion) {
          watcher.dispose()
          return
        }

        stateWatcherBySession.set(sessionId, watcher)
        watcher.start()
        cancelSessionStateWatcherRetry(sessionId)
        stateWatcherRetryCountBySession.delete(sessionId)
        return
      }

      const sessionFilePath = await resolveSessionFilePath({
        provider: input.provider,
        cwd: input.cwd,
        sessionId: resolvedSessionId,
        startedAtMs: input.startedAtMs,
        timeoutMs: SESSION_STATE_WATCHER_FILE_TIMEOUT_MS,
      })

      if ((stateWatcherVersionBySession.get(sessionId) ?? 0) !== watcherVersion) {
        return
      }

      if (!sessionFilePath) {
        if (stateWatcherPendingImmediateRetryBySession.delete(sessionId)) {
          stateWatcherRetryCountBySession.set(sessionId, 0)
          scheduleSessionStateWatcherAttempt(sessionId, watcherVersion, 0)
          return
        }

        scheduleRetry(sessionId, watcherVersion)
        return
      }

      const handleWatcherError = (error: unknown): void => {
        const detail =
          error instanceof Error ? `${error.name}: ${error.message}` : 'unknown watcher error'
        reportIssue(
          `[cove] state watcher failed for ${input.provider} session ${sessionId}: ${detail}`,
        )
        clearSessionStateWatcher(sessionId)
        scheduleSessionStateWatcherAttempt(
          sessionId,
          stateWatcherVersionBySession.get(sessionId) ?? 0,
          resolveSessionStateWatcherRetryDelay(0),
        )
      }

      const watcher = isJsonlProvider(input.provider)
        ? new SessionTurnStateWatcher({
            provider: input.provider,
            sessionId,
            filePath: sessionFilePath,
            onState: broadcastSessionState,
            onError: handleWatcherError,
          })
        : new GeminiSessionStateWatcher({
            sessionId,
            filePath: sessionFilePath,
            launchMode: input.launchMode,
            onState: broadcastSessionState,
            onError: handleWatcherError,
          })

      if ((stateWatcherVersionBySession.get(sessionId) ?? 0) !== watcherVersion) {
        watcher.dispose()
        return
      }

      stateWatcherBySession.set(sessionId, watcher)
      watcher.start()
      cancelSessionStateWatcherRetry(sessionId)
      stateWatcherRetryCountBySession.delete(sessionId)
    } finally {
      stateWatcherStartingSessionIds.delete(sessionId)
    }
  }

  const start = (input: SessionStateWatcherStartInput): void => {
    clearSessionStateWatcher(input.sessionId, { disposeStartInput: true })
    stateWatcherStartInputBySession.set(input.sessionId, input)
    stateWatcherLastInteractionAtMsBySession.set(input.sessionId, input.startedAtMs)

    const watcherVersion = stateWatcherVersionBySession.get(input.sessionId) ?? 0
    if (input.provider === 'gemini' && input.launchMode === 'new' && !input.resumeSessionId) {
      // If the caller already captured (or explicitly skipped) the discovery cursor,
      // avoid capturing it again after the agent has started, which can race with
      // Gemini writing the session file and lead to missing resume bindings.
      if (input.geminiDiscoveryCursor !== undefined) {
        if (input.geminiDiscoveryCursor) {
          geminiDiscoveryCursorBySession.set(input.sessionId, input.geminiDiscoveryCursor)
        }

        scheduleSessionStateWatcherAttempt(input.sessionId, watcherVersion, 0)
        return
      }

      geminiDiscoveryCursorPendingSessionIds.add(input.sessionId)
      void captureGeminiSessionDiscoveryCursor(input.cwd)
        .then(cursor => {
          if ((stateWatcherVersionBySession.get(input.sessionId) ?? 0) !== watcherVersion) {
            return
          }

          if (stateWatcherStartInputBySession.get(input.sessionId) !== input) {
            return
          }

          geminiDiscoveryCursorPendingSessionIds.delete(input.sessionId)
          geminiDiscoveryCursorBySession.set(input.sessionId, cursor)
          scheduleSessionStateWatcherAttempt(input.sessionId, watcherVersion, 0)
        })
        .catch(() => {
          if ((stateWatcherVersionBySession.get(input.sessionId) ?? 0) !== watcherVersion) {
            return
          }

          if (stateWatcherStartInputBySession.get(input.sessionId) !== input) {
            return
          }

          geminiDiscoveryCursorPendingSessionIds.delete(input.sessionId)
          scheduleSessionStateWatcherAttempt(input.sessionId, watcherVersion, 0)
        })
      return
    }

    scheduleSessionStateWatcherAttempt(input.sessionId, watcherVersion, 0)
  }

  const noteInteraction = (sessionId: string, data?: string): void => {
    const input = stateWatcherStartInputBySession.get(sessionId)
    if (!input) {
      return
    }

    const interactionAtMs = Date.now()
    stateWatcherLastInteractionAtMsBySession.set(sessionId, interactionAtMs)

    if (shouldBroadcastOptimisticWorkingFromInteraction({ provider: input.provider, data })) {
      broadcastSessionState(sessionId, 'working')
    }

    const shouldForceImmediateRetry =
      input.provider === 'gemini' &&
      input.launchMode === 'new' &&
      !stateWatcherResolvedResumeSessionIdBySession.has(sessionId) &&
      typeof data === 'string' &&
      /[\r\n]/.test(data)

    const watcher = stateWatcherBySession.get(sessionId)
    if (watcher?.noteInteraction) {
      watcher.noteInteraction()
      return
    }

    if (watcher) {
      return
    }

    if (geminiDiscoveryCursorPendingSessionIds.has(sessionId)) {
      if (shouldForceImmediateRetry) {
        stateWatcherPendingImmediateRetryBySession.add(sessionId)
      }

      return
    }

    if (stateWatcherStartingSessionIds.has(sessionId)) {
      if (shouldForceImmediateRetry) {
        stateWatcherPendingImmediateRetryBySession.add(sessionId)
      }

      return
    }

    stateWatcherRetryCountBySession.set(sessionId, 0)
    scheduleSessionStateWatcherAttempt(
      sessionId,
      stateWatcherVersionBySession.get(sessionId) ?? 0,
      0,
    )
  }

  const disposeSession = (sessionId: string): void => {
    clearSessionStateWatcher(sessionId, { disposeStartInput: true })
  }

  const dispose = (): void => {
    stateWatcherBySession.forEach(watcher => {
      watcher.dispose()
    })
    stateWatcherBySession.clear()
    stateWatcherVersionBySession.clear()
    stateWatcherStartInputBySession.clear()
    stateWatcherLastInteractionAtMsBySession.clear()
    stateWatcherResolvedResumeSessionIdBySession.clear()
    stateWatcherRetryCountBySession.clear()
    stateWatcherStartingSessionIds.clear()
    stateWatcherLastBroadcastResumeSessionIdBySession.clear()
    geminiDiscoveryCursorBySession.clear()
    geminiDiscoveryCursorPendingSessionIds.clear()
    stateWatcherPendingImmediateRetryBySession.clear()

    stateWatcherRetryTimerBySession.forEach(timer => {
      clearTimeout(timer)
    })
    stateWatcherRetryTimerBySession.clear()
  }

  return {
    start,
    noteInteraction,
    disposeSession,
    dispose,
  }
}
