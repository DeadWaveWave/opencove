import { AGENT_PROVIDERS, type AgentProvider } from './agentSettings.providers'
import { isRecord, normalizeTextValue } from './settingsNormalization'

export type AgentExecutablePathOverrideByProvider<TProvider extends string = AgentProvider> =
  Record<TProvider, string>

export const DEFAULT_AGENT_EXECUTABLE_PATH_OVERRIDE_BY_PROVIDER: AgentExecutablePathOverrideByProvider<AgentProvider> =
  {
    'claude-code': '',
    codex: '',
    opencode: '',
    gemini: '',
  }

export function normalizeAgentExecutablePathOverrideByProvider(
  value: unknown,
): AgentExecutablePathOverrideByProvider<AgentProvider> {
  const input = isRecord(value) ? value : {}

  return AGENT_PROVIDERS.reduce<AgentExecutablePathOverrideByProvider<AgentProvider>>(
    (acc, provider) => {
      acc[provider] = normalizeTextValue(input[provider])
      return acc
    },
    { ...DEFAULT_AGENT_EXECUTABLE_PATH_OVERRIDE_BY_PROVIDER },
  )
}
