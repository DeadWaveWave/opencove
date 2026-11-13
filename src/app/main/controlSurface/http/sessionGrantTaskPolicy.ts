import { createAppError } from '../../../../shared/errors/appError'
import type { GrantCheckDeps } from './sessionGrantPolicy'

/** Snapshot-dependent project/holder checks also run in every application CAS plan. */
export function checkTaskClaimIdentity(payload: unknown, { grant }: GrantCheckDeps): void {
  const agentNodeId = (payload as { agentNodeId?: string }).agentNodeId
  if (!grant.nodeId || (agentNodeId !== undefined && agentNodeId !== grant.nodeId)) {
    throw createAppError('common.forbidden', {
      debugMessage: 'You can claim tasks only for your own agent.',
      details: { reason: 'agent_identity_mismatch' },
    })
  }
}
