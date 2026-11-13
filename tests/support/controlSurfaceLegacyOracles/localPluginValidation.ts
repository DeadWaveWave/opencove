// @compat-file control-surface-legacy-validation
// Frozen verbatim from src/contexts/plugins/domain/localPluginValidation.ts at 8834a1127ca0c157548477262b8fd44451cf5bb4.
// Import paths adjusted for the test location.
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
