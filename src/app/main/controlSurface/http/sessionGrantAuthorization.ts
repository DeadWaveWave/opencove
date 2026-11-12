import { getControlSurfaceOperation } from '../../../../shared/contracts/controlSurface/operations'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'
import { sessionGrantRule } from './sessionGrantPolicy'

export function sessionGrantAccess(id: string, tier: 'read' | 'interact' = 'interact') {
  const rule = sessionGrantRule(id)
  const op = getControlSurfaceOperation(id)
  if (rule.access === 'deny') {
    return { access: 'denied' as const, reason: rule.reason }
  }
  if (!op || op.scope === 'admin' || id.startsWith('worker.') || id.startsWith('auth.')) {
    return {
      access: 'denied' as const,
      reason: 'this action requires a human decision in OpenCove',
    }
  }
  if (tier === 'read' && op.scope !== 'read') {
    return { access: 'denied' as const, reason: 'this credential permits read-only operations' }
  }
  return rule.access === 'constrained'
    ? { access: 'constrained' as const, reason: rule.reason, rejectedFields: rule.rejectedFields }
    : { access: 'allowed' as const }
}
export function sessionGrantAllowsOperation(
  id: string,
  tier: 'read' | 'interact' = 'interact',
): boolean {
  return sessionGrantAccess(id, tier).access !== 'denied'
}
export function sessionGrantDeniedError(id: string, tier: 'read' | 'interact' = 'interact') {
  return createAppErrorDescriptor('common.forbidden', {
    details: {
      reason: 'operation_denied',
      operationId: id,
      message: `${id} is not available to agent terminals: ${sessionGrantAccess(id, tier).reason}.`,
    },
  })
}
