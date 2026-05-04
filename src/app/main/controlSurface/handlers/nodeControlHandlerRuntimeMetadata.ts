import type { AgentProviderId, TerminalRuntimeKind } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

export function managedAgentProvider(value: unknown): AgentProviderId {
  if (value === 'claude-code' || value === 'codex' || value === 'opencode' || value === 'gemini') {
    return value
  }
  throw createAppError('agent.launch_failed', { debugMessage: 'Invalid launched provider.' })
}

export function managedTerminalRuntimeKind(value: unknown): TerminalRuntimeKind | null {
  if (value === 'windows' || value === 'wsl' || value === 'posix') {
    return value
  }
  return null
}
