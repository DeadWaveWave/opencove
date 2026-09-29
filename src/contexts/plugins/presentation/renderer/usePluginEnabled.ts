import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  isPluginEnabled,
  isPluginContributionEnabled,
  type PluginContribution,
} from '@contexts/settings/domain/pluginSettings'
import { getBuiltinPluginManifest } from '../../application/builtinPlugins'

/** Enabled contributions are a projection of the existing application settings owner. */
export function usePluginEnabled(pluginId: string): boolean {
  return useAppStore(
    state =>
      getBuiltinPluginManifest(pluginId) !== null && isPluginEnabled(state.agentSettings, pluginId),
  )
}

export function usePluginContributionEnabled(
  pluginId: string,
  contribution: PluginContribution,
): boolean {
  return useAppStore(
    state =>
      getBuiltinPluginManifest(pluginId)?.[contribution] === true &&
      isPluginEnabled(state.agentSettings, pluginId) &&
      isPluginContributionEnabled(state.agentSettings, pluginId, contribution),
  )
}
