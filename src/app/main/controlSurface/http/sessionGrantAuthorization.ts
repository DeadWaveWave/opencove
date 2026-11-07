import { getControlSurfaceOperation } from '../../../../shared/contracts/controlSurface/operations'

export function sessionGrantAllowsOperation(
  id: string,
  tier: 'read' | 'interact' = 'interact',
): boolean {
  if (id.startsWith('worker.') || id === 'auth.issueWebSessionTicket') {
    return false
  }
  const operation = getControlSurfaceOperation(id)
  return operation?.scope === 'read' || (tier === 'interact' && operation?.scope === 'interact')
}
