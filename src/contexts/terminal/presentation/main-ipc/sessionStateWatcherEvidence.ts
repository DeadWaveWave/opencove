import type { ClaudeTranscriptObservation } from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Optimistic Enter is invocation-local activity, never evidence about a cached file identity. */
export function publishAnonymousSessionActivity(
  sessionId: string,
  state: 'working' | 'waiting',
  emit?: (record: ClaudeTranscriptObservation) => void,
): void {
  if (!emit) {
    return
  }
  let generation: number | undefined, incarnation: string | undefined
  const base = {
    sessionId,
    providerSessionId: '',
    generation: 0,
    fileIdentity: 'unattributed-state',
    position: Date.now(),
    baseline: false,
  }
  emit({
    ...base,
    captureConversation: (value, identity) => {
      generation = value
      incarnation = identity
    },
  })
  // Before the first clear the ordinary reducer already records the accepted projection.
  if (generation !== undefined && incarnation) {
    emit({
      ...base,
      incarnation,
      conversationGeneration: generation,
      origin: 'session_file',
      activity: { state, observedAt: Date.now() },
    })
  }
}
