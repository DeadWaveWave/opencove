import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  isPluginEnabled,
  isPluginContributionEnabled,
  type PluginContribution,
} from '@contexts/settings/domain/pluginSettings'
import { usePluginManifest } from './usePluginRegistry'

/** Enabled contributions are a projection of the existing application settings owner. */
export function usePluginEnabled(pluginId: string): boolean {
  const plugin = usePluginManifest(pluginId)
  const enabled = useAppStore(state => isPluginEnabled(state.agentSettings, pluginId))
  return plugin !== null && (plugin.source === 'local' ? plugin.enabled !== false : enabled)
}

export function usePluginContributionEnabled(
  pluginId: string,
  contribution: PluginContribution,
): boolean {
  const plugin = usePluginManifest(pluginId)
  const enabled = usePluginEnabled(pluginId)
  const contributionEnabled = useAppStore(state =>
    isPluginContributionEnabled(state.agentSettings, pluginId, contribution),
  )
  const declared =
    contribution === 'sidebar' ? Boolean(plugin?.sidebar?.length) : plugin?.[contribution] === true
  return declared && enabled && contributionEnabled
}
