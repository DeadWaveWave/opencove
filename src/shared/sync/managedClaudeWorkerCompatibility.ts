import { createAppError } from '../errors/appError'

/** Independent of the release/adoption capability, which remains off until enabling. */
export function assertManagedClaudeWorkerCompatible(value: unknown): void {
  const features = value && typeof value === 'object' && 'features' in value ? value.features : null
  if (
    !features ||
    typeof features !== 'object' ||
    !('managedClaudeResumeBindingDeliveryV1' in features) ||
    features.managedClaudeResumeBindingDeliveryV1 !== true
  ) {
    throw createAppError('agent.managed_launch_rejected', {
      details: { reason: 'workerUpgradeRequired' },
      debugMessage:
        'Update and restart the connected Worker before opening this workspace. Updating the Desktop app alone is not enough.',
    })
  }
}
