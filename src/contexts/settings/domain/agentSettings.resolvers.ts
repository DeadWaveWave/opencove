import type { AgentSettings } from './agentSettings'
import {
  isTaskTitleAgentProvider,
  isWorktreeNameSuggestionProvider,
  type AgentProvider,
  type TaskTitleAgentProvider,
  type WorktreeNameSuggestionAgentProvider,
} from './agentSettings.providers'
import { resolveEnabledEnvForAgent } from './agentEnv'

const DEFAULT_TASK_TITLE_PROVIDER: TaskTitleAgentProvider = 'codex'

export function resolveAgentModel(settings: AgentSettings, provider: AgentProvider): string | null {
  if (!settings.customModelEnabledByProvider[provider]) {
    return null
  }

  const model = settings.customModelByProvider[provider].trim()
  return model.length > 0 ? model : null
}

export function resolveAgentLaunchEnv(
  settings: AgentSettings,
  provider: AgentProvider,
): Record<string, string> {
  return resolveEnabledEnvForAgent({ rows: settings.agentEnvByProvider[provider] ?? [] })
}

export function resolveTaskTitleProvider(settings: AgentSettings): TaskTitleAgentProvider {
  if (settings.taskTitleProvider !== 'default') {
    return settings.taskTitleProvider
  }

  return isTaskTitleAgentProvider(settings.defaultProvider)
    ? settings.defaultProvider
    : DEFAULT_TASK_TITLE_PROVIDER
}

export function resolveWorktreeNameSuggestionProvider(
  defaultProvider: AgentProvider,
): WorktreeNameSuggestionAgentProvider {
  return isWorktreeNameSuggestionProvider(defaultProvider)
    ? defaultProvider
    : DEFAULT_TASK_TITLE_PROVIDER
}

export function resolveTaskTitleModel(settings: AgentSettings): string | null {
  const normalized = settings.taskTitleModel.trim()
  return normalized.length > 0 ? normalized : null
}
