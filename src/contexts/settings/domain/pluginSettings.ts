import { normalizeUniqueStringArray } from './settingsNormalization'

interface PluginEnablementSettings {
  disabledPluginIds?: readonly string[]
}

export type PluginContribution = 'actionBar' | 'contextMenu' | 'sidebar'
export type PluginContributionPreferences = Record<
  string,
  Partial<Record<PluginContribution, boolean>>
>

interface PluginContributionSettings {
  pluginContributions?: PluginContributionPreferences
}

export function normalizePluginContributions(value: unknown): PluginContributionPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, preferences]) => {
      const pluginId = id.trim()
      if (
        !pluginId ||
        !preferences ||
        typeof preferences !== 'object' ||
        Array.isArray(preferences)
      ) {
        return []
      }
      const record = preferences as Record<string, unknown>
      const normalized = Object.fromEntries(
        (['actionBar', 'contextMenu', 'sidebar'] as const)
          .filter(key => typeof record[key] === 'boolean')
          .map(key => [key, record[key]]),
      )
      return [[pluginId, normalized]]
    }),
  )
}

/** An entry preference is independent of plugin availability or its runtime enablement. */
export function isPluginContributionEnabled(
  settings: PluginContributionSettings,
  pluginId: string,
  contribution: PluginContribution,
): boolean {
  return settings.pluginContributions?.[pluginId]?.[contribution] !== false
}

export function setPluginContributionEnabled(
  settings: PluginContributionSettings,
  pluginId: string,
  contribution: PluginContribution,
  enabled: boolean,
): PluginContributionPreferences {
  const preferences = normalizePluginContributions(settings.pluginContributions)
  return {
    ...preferences,
    [pluginId]: { ...preferences[pluginId], [contribution]: enabled },
  }
}

/** Preserve unknown IDs so temporarily unavailable plugins keep the user's preference. */
export function normalizeDisabledPluginIds(value: unknown): string[] {
  return normalizeUniqueStringArray(value)
}

export function isPluginEnabled(settings: PluginEnablementSettings, pluginId: string): boolean {
  return !settings.disabledPluginIds?.includes(pluginId)
}

export function setPluginEnabled(
  settings: PluginEnablementSettings,
  pluginId: string,
  enabled: boolean,
): string[] {
  const disabledIds = normalizeDisabledPluginIds(settings.disabledPluginIds)
  return enabled
    ? disabledIds.filter(id => id !== pluginId)
    : normalizeDisabledPluginIds([...disabledIds, pluginId])
}
