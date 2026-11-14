import { taskMutationAccessMessage } from '../../../../shared/errors/taskMutationAccessError'
import { createAppError } from '../../../../shared/errors/appError'
import type { GrantCheckDeps } from './sessionGrantPolicy'

/** Snapshot-dependent project/holder checks also run in every application CAS plan. */
export function checkTaskCallerIdentity(_payload: unknown, { grant }: GrantCheckDeps): void {
  if (!grant.nodeId) {
    throw createAppError('common.forbidden', {
      debugMessage: taskMutationAccessMessage,
      details: { reason: 'agent_identity_mismatch' },
    })
  }
}
