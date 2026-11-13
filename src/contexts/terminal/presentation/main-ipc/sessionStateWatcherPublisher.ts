import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { TerminalSessionMetadataEvent } from '../../../../shared/contracts/dto'
import {
  setPromptSubmissionEvidence,
  type PromptSubmissionEvidence,
} from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import type { OwnedSessionStateWatcherInput } from './sessionStateWatcherInput'
import { logSessionStateWatcherDiagnostics } from './sessionStateWatcherShared'
import { getClaudeStateRecord } from '../../../../shared/runtime/agentHook/claudeTranscript'

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
      evidence?: Pick<
        PromptSubmissionEvidence,
        | 'providerSessionId'
        | 'conversationGeneration'
        | 'conversationCapture'
        | 'invocationId'
        | 'claudeAuxiliary'
        | 'claudeTranscriptRecord'
      >
      claudeAuxiliary?: true
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
    if (options.evidence || options.claudeAuxiliary) {
      setPromptSubmissionEvidence(eventPayload, {
        ...options.evidence,
        claudeAuxiliary: options.claudeAuxiliary ?? options.evidence?.claudeAuxiliary,
      })
    }
    onState?.(eventPayload)
  }
}

/** Capture once before discovery/IO; callbacks cannot borrow the current conversation. */
export function captureSessionStateObservation(
  input: OwnedSessionStateWatcherInput,
  watcherVersion: number,
  onTranscript:
    | ((
        record: import('../../../../shared/runtime/agentHook/claudeTranscript').ClaudeTranscriptObservation,
      ) => void)
    | undefined,
  publish: ReturnType<typeof createSessionStatePublisher>,
) {
  let providerSessionId = input.resumeSessionId ?? undefined
  let conversationCapture: object | undefined
  let capturedGeneration: number | undefined
  let capturedIncarnation: string | undefined
  if (input.provider === 'claude-code') {
    onTranscript?.({
      sessionId: input.sessionId,
      providerSessionId: providerSessionId ?? '',
      generation: watcherVersion,
      fileIdentity: 'capture',
      position: -1,
      baseline: true,
      captureBinding: binding => {
        conversationCapture = binding
      },
      captureConversation: (value, incarnation) => {
        capturedGeneration = value
        capturedIncarnation = incarnation
      },
    })
  }
  const conversationGeneration = capturedGeneration
  const state: typeof publish = (sessionId, value, options = {}) => {
    if (
      input.provider === 'claude-code' &&
      providerSessionId &&
      !options.degraded &&
      input.discovery?.isCurrent() !== false
    ) {
      onTranscript?.({
        sessionId,
        incarnation: capturedIncarnation,
        providerSessionId,
        generation: watcherVersion,
        conversationGeneration,
        conversationCapture,
        fileIdentity: 'activity',
        position: -1,
        baseline: true,
        auxiliary: options.claudeAuxiliary,
        record: getClaudeStateRecord(options),
        activity: { state: value === 'standby' ? 'idle' : value, observedAt: Date.now() },
      })
    }
    publish(sessionId, value, {
      ...options,
      ...(input.provider === 'claude-code' &&
      (conversationGeneration !== undefined || conversationCapture !== undefined)
        ? {
            evidence: {
              ...(conversationGeneration !== undefined
                ? { providerSessionId, conversationGeneration }
                : {}),
              conversationCapture,
              claudeAuxiliary: options.claudeAuxiliary,
              claudeTranscriptRecord: getClaudeStateRecord(options),
              invocationId: capturedIncarnation,
            },
          }
        : {}),
    })
  }
  return {
    state,
    unavailable: (sessionId: string) => state(sessionId, 'standby', { degraded: true }),
    bind: (id: string) => {
      providerSessionId = id
    },
    get capture() {
      return conversationCapture
    },
    get generation() {
      return conversationGeneration
    },
    get incarnation() {
      return capturedIncarnation
    },
  }
}

export function reportSessionStateWatcherFailure(
  provider: string,
  sessionId: string,
  error: unknown,
  report: (message: string) => void,
): void {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : 'unknown watcher error'
  report(`[opencove] state watcher failed for ${provider} session ${sessionId}: ${detail}`)
}

/** Send the same discovered identity to the UI and the Worker runtime owner. */
export function createSessionMetadataPublisher({
  sendToAllWindows,
  onMetadata,
}: {
  sendToAllWindows: <Payload>(channel: string, payload: Payload) => void
  onMetadata?: (event: TerminalSessionMetadataEvent) => void
}) {
  return (sessionId: string, resumeSessionId: string | null): void => {
    const eventPayload: TerminalSessionMetadataEvent = { sessionId, resumeSessionId }
    logSessionStateWatcherDiagnostics('broadcast-metadata', { sessionId, resumeSessionId })
    sendToAllWindows(IPC_CHANNELS.ptySessionMetadata, eventPayload)
    onMetadata?.(eventPayload)
  }
}
