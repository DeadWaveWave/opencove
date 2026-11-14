// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/ipc/normalize.ts at fff23113f96951bba8004b432539633f7e3c29e0.
const MAX_ENV_ENTRIES = 100
const MAX_ENV_KEY_LENGTH = 256
const MAX_ENV_VALUE_LENGTH = 32_768
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_ENV_PREFIX = 'OPENCOVE_'

export function normalizeEnvPayload(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }

  const result: Record<string, string> = {}
  let count = 0

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_ENV_ENTRIES) {
      break
    }

    const trimmedKey = key.trim()

    if (trimmedKey.length === 0 || typeof value !== 'string') {
      continue
    }

    if (!ENV_KEY_REGEX.test(trimmedKey)) {
      continue
    }

    if (trimmedKey.length > MAX_ENV_KEY_LENGTH) {
      continue
    }

    if (value.length > MAX_ENV_VALUE_LENGTH) {
      continue
    }

    if (trimmedKey.startsWith(RESERVED_ENV_PREFIX)) {
      continue
    }

    result[trimmedKey] = value
    count++
  }

  return count > 0 ? result : undefined
}
