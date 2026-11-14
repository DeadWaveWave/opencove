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

/** Bind a known delivery to its observed namespace before the synchronous write projection. */
export function captureInputProvenance(
  sessionId: string,
  provenance:
    | import('../../../../shared/runtime/sessionInputProvenance').SessionInputProvenance
    | undefined,
  emit?: (record: ClaudeTranscriptObservation) => void,
):
  | import('../../../../shared/runtime/agentHook/claudePromptEvidence').PromptSubmissionEvidence
  | undefined {
  if (!provenance || !emit) {
    return provenance
  }
  let generation: number | undefined, incarnation: string | undefined, capture: object | undefined
  emit({
    sessionId,
    incarnation: provenance.invocationId,
    providerSessionId: provenance.providerSessionId,
    generation: 0,
    fileIdentity: 'delivery-input',
    position: -1,
    baseline: false,
    captureConversation: (value, identity) => {
      generation = value
      incarnation = identity
    },
    captureBinding: binding => {
      capture = binding
    },
  })
  return incarnation === provenance.invocationId && generation === provenance.conversationGeneration
    ? { ...provenance, conversationCapture: capture }
    : provenance
}
