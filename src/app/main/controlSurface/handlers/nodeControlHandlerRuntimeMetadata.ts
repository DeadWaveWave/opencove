import {
  AGENT_PROVIDER_IDS,
  type AgentProviderId,
  type TerminalRuntimeKind,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

export function managedAgentProvider(value: unknown): AgentProviderId {
  if (typeof value === 'string' && AGENT_PROVIDER_IDS.includes(value as AgentProviderId)) {
    return value as AgentProviderId
  }
  throw createAppError('agent.launch_failed', { debugMessage: 'Invalid launched provider.' })
}

export function managedTerminalRuntimeKind(value: unknown): TerminalRuntimeKind | null {
  if (value === 'windows' || value === 'wsl' || value === 'posix') {
    return value
  }
  return null
}
