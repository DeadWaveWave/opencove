// @compat-file control-surface-legacy-validation
// Frozen from src/contexts/topology/domain/managedSshPort.ts at 6df96903c64d6fb3c541c79815713996d3c1b186.
export type OptionalManagedSshPort =
  | { state: 'empty'; value: null }
  | { state: 'valid'; value: number }
  | { state: 'invalid'; value: null }

export function parseOptionalManagedSshPort(input: string): OptionalManagedSshPort {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { state: 'empty', value: null }
  }

  if (!/^\d+$/.test(trimmed)) {
    return { state: 'invalid', value: null }
  }

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    return { state: 'invalid', value: null }
  }

  return { state: 'valid', value }
}
