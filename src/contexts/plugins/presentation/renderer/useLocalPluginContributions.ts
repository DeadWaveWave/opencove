import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  isPluginContributionEnabled,
  type PluginContribution,
} from '@contexts/settings/domain/pluginSettings'
import { usePluginRegistry } from './usePluginRegistry'

export function useLocalPluginContributions(contribution: PluginContribution) {
  const { plugins } = usePluginRegistry()
  const settings = useAppStore(state => state.agentSettings)
  return plugins.filter(
    plugin =>
      plugin.source === 'local' &&
      plugin.enabled !== false &&
      plugin.status === 'ready' &&
      plugin[contribution] &&
      isPluginContributionEnabled(settings, plugin.id, contribution),
  )
}
