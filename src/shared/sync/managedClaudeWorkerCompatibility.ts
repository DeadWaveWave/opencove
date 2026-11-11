import { createAppError, toAppErrorDescriptor } from '../errors/appError'

/** Protocol support is relevant to ownership operations, never workspace synchronization. */
export function supportsManagedClaudeOwnership(value: unknown): boolean {
  const features = value && typeof value === 'object' && 'features' in value ? value.features : null
  return (
    !!features &&
    typeof features === 'object' &&
    'managedClaudeResumeBindingDeliveryV1' in features &&
    features.managedClaudeResumeBindingDeliveryV1 === true
  )
}
export function assertManagedClaudeWorkerCompatible(value: unknown): void {
  if (!supportsManagedClaudeOwnership(value)) {
    throw createAppError('agent.managed_launch_rejected', {
      details: { reason: 'workerUpgradeRequired' },
      debugMessage:
        'Update and restart the connected Worker before managing Claude agents. Your workspace remains available.',
    })
  }
}

export function isWorkerConnectionRefusal(error: unknown): boolean {
  const descriptor = toAppErrorDescriptor(error)
  return (
    descriptor.code === 'common.protocol_incompatible' ||
    (descriptor.code === 'agent.managed_launch_rejected' &&
      descriptor.details &&
      typeof descriptor.details === 'object' &&
      'reason' in descriptor.details &&
      descriptor.details.reason === 'workerUpgradeRequired') === true
  )
}
