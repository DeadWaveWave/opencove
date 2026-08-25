import { AGENT_PROVIDER_IDS } from '../../../shared/contracts/dto'

export const AGENT_PROVIDERS = AGENT_PROVIDER_IDS
export const TASK_TITLE_PROVIDERS = ['claude-code', 'codex'] as const
export const WORKTREE_NAME_SUGGESTION_PROVIDERS = ['claude-code', 'codex'] as const
export const EXPERIMENTAL_AGENT_PROVIDERS = [] as const

export type AgentProvider = (typeof AGENT_PROVIDERS)[number]
export const SELECTABLE_AGENT_PROVIDERS = [
  'claude-code',
  'codex',
  'opencode',
  'pi',
  'kimi',
] as const satisfies readonly AgentProvider[]
export type SelectableAgentProvider = (typeof SELECTABLE_AGENT_PROVIDERS)[number]
export type TaskTitleAgentProvider = (typeof TASK_TITLE_PROVIDERS)[number]
export type WorktreeNameSuggestionAgentProvider =
  (typeof WORKTREE_NAME_SUGGESTION_PROVIDERS)[number]

export function isValidProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && AGENT_PROVIDERS.includes(value as AgentProvider)
}

export function isSelectableAgentProvider(value: unknown): value is SelectableAgentProvider {
  return (
    typeof value === 'string' &&
    SELECTABLE_AGENT_PROVIDERS.includes(value as SelectableAgentProvider)
  )
}

export function resolveSelectableAgentProvider(value: unknown): SelectableAgentProvider {
  return isSelectableAgentProvider(value) ? value : SELECTABLE_AGENT_PROVIDERS[0]
}

export function isTaskTitleAgentProvider(value: unknown): value is TaskTitleAgentProvider {
  return typeof value === 'string' && TASK_TITLE_PROVIDERS.includes(value as TaskTitleAgentProvider)
}

export function isWorktreeNameSuggestionProvider(
  value: unknown,
): value is WorktreeNameSuggestionAgentProvider {
  return (
    typeof value === 'string' &&
    WORKTREE_NAME_SUGGESTION_PROVIDERS.includes(value as WorktreeNameSuggestionAgentProvider)
  )
}

export function normalizeAgentProviderOrder(value: unknown): AgentProvider[] {
  if (!Array.isArray(value)) {
    return [...AGENT_PROVIDERS]
  }

  const normalized: AgentProvider[] = []
  const seen = new Set<AgentProvider>()

  for (const item of value) {
    if (!isValidProvider(item)) {
      continue
    }

    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    normalized.push(item)
  }

  for (const provider of AGENT_PROVIDERS) {
    if (seen.has(provider)) {
      continue
    }

    seen.add(provider)
    normalized.push(provider)
  }

  return normalized
}

export function normalizeSelectableAgentProviderOrder(value: unknown): SelectableAgentProvider[] {
  return normalizeAgentProviderOrder(value).filter(isSelectableAgentProvider)
}

export function mergeSelectableAgentProviderOrder(
  currentValue: unknown,
  selectableValue: unknown,
): AgentProvider[] {
  const currentOrder = normalizeAgentProviderOrder(currentValue)
  const selectableOrder = normalizeSelectableAgentProviderOrder(selectableValue)
  let selectableIndex = 0

  return currentOrder.map(provider => {
    if (!isSelectableAgentProvider(provider)) {
      return provider
    }

    const replacement = selectableOrder[selectableIndex]
    selectableIndex += 1
    return replacement ?? provider
  })
}
