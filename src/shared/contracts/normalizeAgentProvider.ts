import { AGENT_PROVIDER_IDS, type AgentProviderId } from './dto'
import { createAppError } from '../errors/appError'
export function normalizeProvider(value: unknown): AgentProviderId {
  if (typeof value !== 'string' || !AGENT_PROVIDER_IDS.includes(value as AgentProviderId)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid provider' })
  }

  return value as AgentProviderId
}
