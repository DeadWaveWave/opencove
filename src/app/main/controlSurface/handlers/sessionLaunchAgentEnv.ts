import { createAppError } from '../../../../shared/errors/appError'

const MAX_AGENT_SESSION_ENV_ENTRIES = 200
const MAX_AGENT_SESSION_ENV_KEY_LENGTH = 120
const MAX_AGENT_SESSION_ENV_VALUE_LENGTH = 10_000
const AGENT_SESSION_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const AGENT_SESSION_ENV_RESERVED_PREFIX = 'OPENCOVE_'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeLaunchAgentEnv(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) {
    return null
  }

  if (!isPlainRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent env.',
    })
  }

  const resolved: Record<string, string> = {}
  let entryCount = 0

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (entryCount >= MAX_AGENT_SESSION_ENV_ENTRIES) {
      break
    }

    const key = rawKey.trim().slice(0, MAX_AGENT_SESSION_ENV_KEY_LENGTH)
    if (key.length === 0) {
      continue
    }

    if (
      AGENT_SESSION_ENV_RESERVED_PREFIX.length > 0 &&
      key.startsWith(AGENT_SESSION_ENV_RESERVED_PREFIX)
    ) {
      continue
    }

    if (!AGENT_SESSION_ENV_KEY_PATTERN.test(key)) {
      continue
    }

    if (typeof rawValue !== 'string') {
      continue
    }

    resolved[key] = rawValue.slice(0, MAX_AGENT_SESSION_ENV_VALUE_LENGTH)
    entryCount += 1
  }

  return Object.keys(resolved).length > 0 ? resolved : null
}
