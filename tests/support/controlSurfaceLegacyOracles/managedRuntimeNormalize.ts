// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/managedRuntimeHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Validator body unchanged.
export function maintenanceOracle(instanceId: string) {
  const options = { instanceId }
  const validate = (value: unknown): { lease: string } => {
    if (!value || typeof value !== 'object') {
      throw new Error('Expected maintenance request.')
    }
    const record = value as Record<string, unknown>
    if (
      record.instanceId !== options.instanceId ||
      typeof record.lease !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(record.lease)
    ) {
      throw new Error('Invalid maintenance target or lease.')
    }
    return { lease: record.lease }
  }

  return validate
}
