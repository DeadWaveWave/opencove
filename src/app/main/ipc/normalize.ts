import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
export function normalizeProvider(value: unknown): AgentProviderId {
  if (typeof value !== 'string' || !AGENT_PROVIDER_IDS.includes(value as AgentProviderId)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid provider' })
  }

  return value as AgentProviderId
}

export { normalizeEnvPayload } from '../../../shared/contracts/normalizeTerminalEnv'

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
