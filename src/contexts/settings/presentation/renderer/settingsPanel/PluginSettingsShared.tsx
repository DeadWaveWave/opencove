import type { JSX } from 'react'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'

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
  disabled = false,
}: {
  plugin: PluginManifest
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Toggle
      className="settings-plugin__toggle"
      data-testid={`settings-plugin-enabled-${plugin.id}`}
      checked={enabled}
      disabled={disabled}
      label={t('settingsPanel.plugins.enable', { name: plugin.displayName })}
      onCheckedChange={onChange}
    />
  )
}
