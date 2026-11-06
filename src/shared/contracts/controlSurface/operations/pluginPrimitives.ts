export function pluginRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a plugin object.')
  }
  return value as Record<string, unknown>
}

export function pluginString(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Invalid plugin ${field}.`)
  }
  return value.trim()
}
