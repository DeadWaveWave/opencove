import type { AgentProviderId } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'

export function normalizeProvider(value: unknown): AgentProviderId {
  if (value !== 'claude-code' && value !== 'codex' && value !== 'opencode' && value !== 'gemini') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid provider' })
  }

  return value
}

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

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const trimmed = item.trim()
    if (trimmed.length === 0 || normalized.includes(trimmed)) {
      continue
    }

    normalized.push(trimmed)
  }

  return normalized
}
