import { tracksClaudeConversations } from '../../../../shared/contracts/agentProviderDescriptors'
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
import { publishAnonymousSessionActivity } from './sessionStateWatcherEvidence'

/** Publishes current watcher evidence through the Worker observation port. */
export function createSessionStatePublisher({
  getInput,
  onState,
  onClaudeTranscript,
}: {
  getInput: (sessionId: string) => OwnedSessionStateWatcherInput | undefined
  onState?: (event: TerminalSessionStateEvent) => void
  onClaudeTranscript?: Parameters<typeof publishAnonymousSessionActivity>[2]
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
    if (
      tracksClaudeConversations(eventPayload.agentProvider) &&
      eventPayload.source === 'session_file' &&
      !options.evidence?.providerSessionId &&
      !options.evidence?.conversationCapture &&
      (state !== 'standby' || options.degraded)
    ) {
      publishAnonymousSessionActivity(
        sessionId,
        state === 'waiting' ? 'waiting' : 'working',
        onClaudeTranscript,
      )
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
  const captureConversation = (value: number | undefined, identity?: string) => {
    if (capturedIncarnation === undefined) {
      capturedGeneration = value
      capturedIncarnation = identity
    }
  }
  if (tracksClaudeConversations(input.provider)) {
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
      captureConversation,
    })
  }
  const state: typeof publish = (sessionId, value, options = {}) => {
    if (
      tracksClaudeConversations(input.provider) &&
      providerSessionId &&
      !options.degraded &&
      input.discovery?.isCurrent() !== false
    ) {
      onTranscript?.({
        sessionId,
        incarnation: capturedIncarnation,
        providerSessionId,
        generation: watcherVersion,
        conversationGeneration: capturedGeneration,
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
      ...(tracksClaudeConversations(input.provider)
        ? {
            evidence: {
              providerSessionId,
              conversationGeneration: capturedGeneration,
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
      if (
        providerSessionId === id &&
        (!tracksClaudeConversations(input.provider) || capturedIncarnation !== undefined)
      ) {
        return
      }
      providerSessionId = id
      if (tracksClaudeConversations(input.provider)) {
        onTranscript?.({
          sessionId: input.sessionId,
          providerSessionId: id,
          incarnation: capturedIncarnation,
          generation: watcherVersion,
          fileIdentity: 'capture',
          position: -1,
          baseline: true,
          ...(capturedIncarnation === undefined ? { captureConversation } : {}),
          captureBinding: binding => {
            conversationCapture = binding
          },
        })
      }
    },
    get capture() {
      return conversationCapture
    },
    get generation() {
      return capturedGeneration
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
