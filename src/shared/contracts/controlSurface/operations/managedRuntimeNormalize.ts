export function normalizeMaintenancePayload(
  value: unknown,
  instanceId: unknown,
): { lease: string } {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected maintenance request.')
  }
  const record = value as Record<string, unknown>
  if (
    record.instanceId !== instanceId ||
    typeof record.lease !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(record.lease)
  ) {
    throw new Error('Invalid maintenance target or lease.')
  }
  return { lease: record.lease }
}

// The registry validates the lease; composition binds the authoritative instance identity.
export function normalizeMaintenanceWire(value: unknown): { lease: string } {
  return normalizeMaintenancePayload(
    value,
    value && typeof value === 'object' ? (value as Record<string, unknown>).instanceId : undefined,
  )
}
