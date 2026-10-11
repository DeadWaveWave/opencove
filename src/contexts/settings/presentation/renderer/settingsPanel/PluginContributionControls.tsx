import type { JSX } from 'react'
import { MousePointer2, PanelRight, PanelLeft } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  isPluginContributionEnabled,
  type PluginContribution,
} from '@contexts/settings/domain/pluginSettings'

const CONTRIBUTIONS = [
  { key: 'actionBar', Icon: PanelRight },
  { key: 'contextMenu', Icon: MousePointer2 },
  { key: 'sidebar', Icon: PanelLeft },
] as const

export function PluginContributionControls({
  plugin,
  settings,
  onChange,
}: {
  plugin: PluginManifest
  settings: Pick<AgentSettings, 'pluginContributions'>
  onChange: (contribution: PluginContribution, enabled: boolean) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const contributions = CONTRIBUTIONS.filter(({ key }) =>
    key === 'sidebar' ? Boolean(plugin.sidebar?.length) : plugin[key],
  )
  if (contributions.length === 0) {
    return null
  }
  const titleId = `settings-plugin-contributions-title-${plugin.id}`
  return (
    <div className="settings-plugin-contributions" role="group" aria-labelledby={titleId}>
      <div className="settings-plugin-contributions__heading">
        <h4 id={titleId}>{t('settingsPanel.plugins.contributions.title')}</h4>
      </div>
      <div className="settings-plugin-contributions__options">
        {contributions.map(({ key, Icon }) => (
          <label
            className="settings-plugin-contribution"
            data-testid={`settings-plugin-contribution-tile-${key}-${plugin.id}`}
            key={key}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="settings-plugin-contribution__copy">
              <span className="settings-plugin-contribution__title">
                {t(`settingsPanel.plugins.capabilities.${key}`)}
              </span>
              <span
                className="settings-plugin-contribution__description"
                id={`settings-plugin-contribution-description-${key}-${plugin.id}`}
              >
                {t(`settingsPanel.plugins.contributions.${key}Description`)}
              </span>
            </span>
            <Toggle
              data-testid={`settings-plugin-contribution-${key}-${plugin.id}`}
              checked={isPluginContributionEnabled(settings, plugin.id, key)}
              label={t(`settingsPanel.plugins.contributions.${key}`)}
              describedBy={`settings-plugin-contribution-description-${key}-${plugin.id}`}
              onCheckedChange={enabled => onChange(key, enabled)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
