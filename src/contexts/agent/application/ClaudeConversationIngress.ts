import {
  ClaudeConversationLifecycle,
  isClaudeConversationActivity,
} from '../domain/ClaudeConversationLifecycle'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { AgentRunObservation } from '../domain/agentRunState'
import type { ClaudeLiveConversation } from './ClaudeLiveConversation'

type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
/** After a clear, the namespace fence survives its receipt; the original classifier still owns
 * fresh ordinary transitions. Before the first clear this function is never called. */
export function routeOrdinaryClaudeConversation(
  owner: ClaudeLiveConversation,
  request: Request,
  observation?: Pick<AgentRunObservation, 'state' | 'emittedAtMs'>,
): 'ordinary' | 'boundary' | 'pending' | 'ignored' {
  const event = request.event
  const initial = owner.checkpoint
  const lifecycle = new ClaudeConversationLifecycle(initial)
  const action = lifecycle.accept(event)
  const starts = event.hookEventName === 'SessionStart'
  const stale =
    (initial?.startAt !== undefined &&
      (event.emittedAtMs === undefined || event.emittedAtMs < initial.startAt)) ||
    (!starts &&
      (observation?.state === 'waiting' || observation?.state === 'working') &&
      event.emittedAtMs !== undefined &&
      observation.emittedAtMs !== undefined &&
      event.emittedAtMs < observation.emittedAtMs)
  if (
    (starts && action === 'ignore') ||
    (!starts && (event.claudeSessionId !== owner.providerSessionId || stale || owner.closedByClear))
  ) {
    if (
      owner.closedByClear &&
      !starts &&
      event.claudeSessionId === owner.providerSessionId &&
      event.emittedAtMs !== undefined &&
      event.emittedAtMs > (initial?.watermark ?? -Infinity) &&
      isClaudeConversationActivity(event)
    ) {
      return 'pending'
    }
    const unknownActivity =
      !starts &&
      !stale &&
      !initial?.retired.some(item => item.sessionId === event.claudeSessionId) &&
      isClaudeConversationActivity(event)
    if (unknownActivity) {
      return 'pending'
    }
    request.decide({ action: 'ignore', generation: owner.generation, deferred: true })
    request.publish(owner.generation, 'ignore')
    return 'ignored'
  }
  return action === 'start' ? 'boundary' : 'ordinary'
}
