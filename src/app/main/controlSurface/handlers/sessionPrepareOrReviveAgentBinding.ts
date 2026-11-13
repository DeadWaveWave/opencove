import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '../../../../contexts/agent/domain/agentResumeBinding'
import type { NormalizedPersistedNode, PersistedAgentLike } from './sessionPrepareOrReviveShared'
import { resolvePendingResumeSessionId } from './sessionPrepareOrReviveResumeBinding'

// @compat managed-claude-worker-support
/** Owned bindings bypass all transcript heuristics; legacy discovery remains unchanged. */
export async function resolvePreparationAgentBinding(
  node: NormalizedPersistedNode,
  agent: PersistedAgentLike,
  hasRecoverableStatus: boolean,
  owned: boolean,
): Promise<PersistedAgentLike> {
  const resolvedPendingResumeSessionId =
    !owned && hasRecoverableStatus && !isResumeSessionBindingVerified(agent)
      ? await resolvePendingResumeSessionId(node, agent)
      : null
  return resolvedPendingResumeSessionId
    ? {
        ...agent,
        resumeSessionId: resolvedPendingResumeSessionId,
        resumeSessionIdVerified: true,
      }
    : isResumeSessionBindingVerified(agent)
      ? agent
      : {
          ...agent,
          ...clearResumeSessionBinding(),
        }
}
