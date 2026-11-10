import type { AgentRunSnapshot } from '@shared/contracts/dto/agentRunState'

/** Attention grouping includes both a live dialog and an unacknowledged completion. */
export function agentAttentionLabelKey(input: {
  needsYouSinceMs?: number
  blockedReason?: AgentRunSnapshot['blockedReason']
}): string {
  if (input.needsYouSinceMs !== undefined) {
    return 'agentAttention.finished'
  }
  switch (input.blockedReason) {
    case 'permission':
      return 'agentAttention.permission'
    case 'question':
      return 'agentAttention.question'
    case 'plan':
      return 'agentAttention.plan'
    default:
      return 'agentAttention.blocked'
  }
}
