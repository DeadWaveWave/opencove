import type { JSX } from 'react'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import { useTranslation, type TranslateFn } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'

export function pluginDescription(plugin: PluginManifest, t: TranslateFn): string {
  return plugin.id === 'git-board'
    ? t('settingsPanel.plugins.gitBoardDescription')
    : plugin.description
}

export function PluginSettingsGlyph({ pluginId }: { pluginId: string }): JSX.Element {
  return (
    <span className="settings-plugin__glyph" aria-hidden="true">
      <PluginIcon pluginId={pluginId} size={24} strokeWidth={1.55} />
    </span>
  )
}

export function PluginSettingsToggle({
  plugin,
  enabled,
  onChange,
}: {
  plugin: PluginManifest
  enabled: boolean
  onChange: (enabled: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <label className="cove-toggle settings-plugin__toggle">
      <input
        type="checkbox"
        data-testid={`settings-plugin-enabled-${plugin.id}`}
        checked={enabled}
        aria-label={t('settingsPanel.plugins.enable', { name: plugin.displayName })}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="cove-toggle__slider" />
    </label>
  )
}
