import type { AgentHookStateSource } from '../contracts/dto'

export function isAgentHookStateSource(value: unknown): value is AgentHookStateSource {
  return value === 'claude_hook' || value === 'codex_hook' || value === 'pi_hook'
}
