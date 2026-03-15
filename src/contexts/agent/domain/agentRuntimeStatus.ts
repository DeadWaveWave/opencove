import type { AgentRuntimeStatus } from './types'

export function resolveInitialAgentRuntimeStatus(
  prompt: string | null | undefined,
): AgentRuntimeStatus {
  return typeof prompt === 'string' && prompt.trim().length > 0 ? 'running' : 'standby'
}
