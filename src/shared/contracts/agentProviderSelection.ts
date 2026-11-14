import type { AgentProviderId } from './dto'

export const SELECTABLE_AGENT_PROVIDERS = [
  'claude-code',
  'codex',
  'opencode',
  'pi',
  'kimi',
] as const satisfies readonly AgentProviderId[]
export type SelectableAgentProvider = (typeof SELECTABLE_AGENT_PROVIDERS)[number]
export function isSelectableAgentProvider(value: unknown): value is SelectableAgentProvider {
  return (
    typeof value === 'string' &&
    SELECTABLE_AGENT_PROVIDERS.includes(value as SelectableAgentProvider)
  )
}

export function resolveSelectableAgentProvider(value: unknown): SelectableAgentProvider {
  return isSelectableAgentProvider(value) ? value : SELECTABLE_AGENT_PROVIDERS[0]
}
