import type { AgentRunEntry } from './AgentRunStateEntry'
import type { AgentRunObservation } from '../domain/agentRunState'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'

/** A clear Start can qualify a new Stop baseline, never revive a retired prompt's receipt.
 * This predicate has no effects; source freshness must pass before releasing the barrier. */
export function permitsClearBaseline(
  entry: AgentRunEntry,
  observation: AgentRunObservation | null,
  evidence: PromptSubmissionEvidence | undefined,
): boolean {
  const id = entry.conversation?.clearIdentity
  return Boolean(
    id &&
    observation?.source === 'claude_hook' &&
    observation.state === 'idle' &&
    !observation.degraded &&
    ['Stop', 'StopFailure'].includes(observation.hookEventName ?? '') &&
    evidence?.providerSessionId === id &&
    evidence.promptId &&
    (!entry.history.hasEndedPrompt(evidence.promptId, id) ||
      entry.conversationReplay?.completedReceipt(id, observation.emittedAtMs)),
  )
}
