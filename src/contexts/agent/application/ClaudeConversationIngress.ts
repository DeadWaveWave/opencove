import {
  ClaudeConversationLifecycle,
  isClaudeConversationActivity,
} from '../domain/ClaudeConversationLifecycle'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import {
  getPromptSubmissionEvidence,
  setPromptSubmissionEvidence,
} from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { ClaudeLiveConversation } from './ClaudeLiveConversation'

type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
/** After a clear, the namespace fence survives its receipt; the original classifier still owns
 * fresh ordinary transitions. Before the first clear this function is never called. */
export function routeOrdinaryClaudeConversation(
  owner: ClaudeLiveConversation,
  request: Request,
): boolean {
  const event = request.event
  const initial = request.initialState
  const lifecycle = new ClaudeConversationLifecycle(initial)
  const action = lifecycle.accept(event)
  const starts = event.hookEventName === 'SessionStart'
  const stale =
    initial?.startAt !== undefined &&
    (event.emittedAtMs === undefined || event.emittedAtMs < initial.startAt)
  if (
    (starts && action === 'ignore') ||
    (!starts && (event.claudeSessionId !== owner.providerSessionId || stale || owner.closedByClear))
  ) {
    request.decide({ action: 'ignore', generation: owner.generation, deferred: true })
    request.publish(owner.generation, 'ignore')
    const unknownActivity =
      !starts &&
      !stale &&
      !initial?.retired.some(item => item.sessionId === event.claudeSessionId) &&
      isClaudeConversationActivity(event)
    if (unknownActivity) {
      owner.veto()
    }
    return unknownActivity
  }
  owner.followOrdinary(lifecycle.checkpoint(), action === 'start' || action === 'end', starts)
  setPromptSubmissionEvidence(event, {
    ...getPromptSubmissionEvidence(event),
    conversationGeneration: owner.generation,
  })
  if (isClaudeConversationActivity(event)) {
    owner.veto()
  }
  return false
}
