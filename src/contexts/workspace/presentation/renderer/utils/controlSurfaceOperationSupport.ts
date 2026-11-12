import { createAppError } from '@shared/errors/appError'

/** Negotiate against this Worker, without inferring support from its version or error text. */
export async function supportsWorkerOperation(id: string): Promise<boolean> {
  const registry = await window.opencoveApi.controlSurface.invoke<{
    protocolVersion: number
    operations: { id: string }[]
  }>({ kind: 'query', id: 'system.operations', payload: {} })
  if (
    !registry ||
    typeof registry.protocolVersion !== 'number' ||
    !Array.isArray(registry.operations) ||
    !registry.operations.every(operation => operation && typeof operation.id === 'string')
  ) {
    throw createAppError('persistence.unavailable')
  }
  return registry.operations.some(operation => operation.id === id)
}
