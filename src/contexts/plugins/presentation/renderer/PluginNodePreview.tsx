import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { usePluginManifest } from './usePluginRegistry'
import { PluginRuntimePreview } from './PluginRuntimePreview'

/** Only a declared, independently installed preview may start a preview runtime. */
export function PluginNodePreview({ pluginId }: { pluginId: string }): JSX.Element {
  const { t } = useTranslation()
  const plugin = usePluginManifest(pluginId)
  return plugin?.source === 'local' && plugin.hasPreview ? (
    <PluginRuntimePreview key={plugin.id} plugin={plugin} />
  ) : (
    <p>{t('settingsPanel.plugins.preview.unavailable')}</p>
  )
}
