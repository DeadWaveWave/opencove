import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../src/contexts/settings/domain/agentSettings'

/**
 * A `readAgentSettings` for a canvas or a hook under test: the app's settings with `overrides`,
 * the same object on every call, as the shell's reader returns while the store is unchanged.
 */
export function createAgentSettingsReader(
  overrides: Partial<AgentSettings> = {},
): () => AgentSettings {
  const settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, ...overrides }
  return () => settings
}

const readers = new WeakMap<AgentSettings, () => AgentSettings>()

/**
 * The two props a canvas under test takes for its settings: `agentSettings` for rendering and
 * `readAgentSettings` for the commands, both of `settings`. The reader of one settings object is
 * the same function on every call, as the shell's is for the lifetime of the app.
 */
export function agentSettingsProps(settings: AgentSettings): {
  agentSettings: AgentSettings
  readAgentSettings: () => AgentSettings
} {
  let read = readers.get(settings)
  if (!read) {
    read = () => settings
    readers.set(settings, read)
  }
  return { agentSettings: settings, readAgentSettings: read }
}
