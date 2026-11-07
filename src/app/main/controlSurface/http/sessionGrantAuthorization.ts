import { getControlSurfaceOperation } from '../../../../shared/contracts/controlSurface/operations'

export function sessionGrantAllowsOperation(id: string): boolean {
  if (id.startsWith('worker.') || id === 'auth.issueWebSessionTicket') {
    return false
  }
  const operation = getControlSurfaceOperation(id)
  return operation?.scope === 'read' || operation?.scope === 'interact'
}
