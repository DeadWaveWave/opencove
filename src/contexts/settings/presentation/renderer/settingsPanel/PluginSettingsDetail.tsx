import type { JSX } from 'react'
import { ArrowLeft, LayoutDashboard, MousePointer2, PanelRight } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PluginContribution } from '@contexts/settings/domain/pluginSettings'
import { getPluginDetail } from '@contexts/plugins/presentation/renderer/pluginDetails'
import { PluginReadme } from '@contexts/plugins/presentation/renderer/PluginReadme'
import { usePluginDetails } from '@contexts/plugins/presentation/renderer/usePluginDetails'
import { PluginRuntimeControls } from './PluginRuntimeControls'
import { PluginNodePreview } from '@contexts/plugins/presentation/renderer/PluginNodePreview'
import {
  PluginSettingsGlyph,
  PluginSettingsToggle,
  pluginDescription,
} from './PluginSettingsShared'
import { PluginContributionControls } from './PluginContributionControls'

export function PluginSettingsDetail({
  plugin,
  enabled,
  busy = false,
  settings,
  onChangeEnabled,
  onChangeContribution,
  onBack,
}: {
  plugin: PluginManifest
  enabled: boolean
  busy?: boolean
  settings: Pick<AgentSettings, 'pluginContributions'>
  onChangeEnabled: (enabled: boolean) => void
  onChangeContribution: (contribution: PluginContribution, enabled: boolean) => void
  onBack: () => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const installed = usePluginDetails(plugin)
  const detail =
    plugin.source === 'local'
      ? installed.detail && { ...installed.detail, author: plugin.author }
      : getPluginDetail(plugin.id, i18n.language)
  return (
    <div className="settings-plugin-detail" data-testid={`settings-plugin-detail-${plugin.id}`}>
      <button
        type="button"
        className="settings-plugin-detail__back"
        data-testid="settings-plugin-back"
        onClick={onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t('settingsPanel.plugins.back')}
      </button>
      <header
        className="settings-plugin-detail__header"
        data-testid={`settings-plugin-${plugin.id}`}
      >
        <PluginSettingsGlyph pluginId={plugin.id} />
        <div className="settings-plugin-detail__identity">
          <h3 tabIndex={-1} data-plugin-detail-heading>
            {plugin.displayName}
          </h3>
          <div className="settings-plugin__byline">
            {detail?.author ? <span>{detail.author}</span> : null}
            <span>
              {t(`settingsPanel.plugins.${plugin.source === 'local' ? 'local' : 'builtIn'}`)}
            </span>
            <span aria-label={t('settingsPanel.plugins.version', { version: plugin.version })}>
              {plugin.version}
            </span>
          </div>
        </div>
        <div className="settings-plugin-detail__enable">
          <span>{t(`settingsPanel.plugins.${enabled ? 'enabled' : 'disabled'}`)}</span>
          <PluginSettingsToggle
            plugin={plugin}
            enabled={enabled}
            disabled={busy}
            onChange={onChangeEnabled}
          />
        </div>
      </header>
      <p className="settings-plugin-detail__description">{pluginDescription(plugin, t)}</p>
      <div
        className="settings-plugin__capabilities"
        aria-label={t('settingsPanel.plugins.capabilitiesLabel')}
      >
        {plugin.nodeKinds.length ? (
          <span>
            <LayoutDashboard size={13} aria-hidden="true" />
            {t('settingsPanel.plugins.capabilities.canvas')}
          </span>
        ) : null}
        {plugin.actionBar ? (
          <span>
            <PanelRight size={13} aria-hidden="true" />
            {t('settingsPanel.plugins.capabilities.actionBar')}
          </span>
        ) : null}
        {plugin.contextMenu ? (
          <span>
            <MousePointer2 size={13} aria-hidden="true" />
            {t('settingsPanel.plugins.capabilities.contextMenu')}
          </span>
        ) : null}
      </div>
      {plugin.source === 'local' ? (
        <PluginRuntimeControls plugin={plugin} detail={installed.detail} onRemoved={onBack} />
      ) : null}
      {installed.error ? (
        <p className="cove-window__error" role="alert">
          {installed.error}
        </p>
      ) : null}
      <PluginContributionControls
        plugin={plugin}
        settings={settings}
        onChange={onChangeContribution}
      />
      {plugin.nodeKinds.length > 0 ? <PluginNodePreview pluginId={plugin.id} /> : null}
      {detail ? (
        <section
          className="settings-plugin-detail__readme"
          aria-label={t('settingsPanel.plugins.documentation')}
        >
          <PluginReadme markdown={detail.readme} assets={detail.assets} />
        </section>
      ) : null}
    </div>
  )
}
