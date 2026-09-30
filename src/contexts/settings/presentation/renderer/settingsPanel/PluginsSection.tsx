import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'
import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  usePluginRegistry,
  changeInstalledPlugin,
  refreshPluginRegistry,
} from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { isPluginEnabled, type PluginContribution } from '@contexts/settings/domain/pluginSettings'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'
import { PluginDevelopmentGuide } from './PluginDevelopmentGuide'
import { PluginSettingsDetail } from './PluginSettingsDetail'
import {
  PluginSettingsGlyph,
  PluginSettingsToggle,
  pluginDescription,
} from './PluginSettingsShared'

function pluginEnabled(
  plugin: PluginManifest,
  settings: Pick<AgentSettings, 'disabledPluginIds'>,
): boolean {
  return plugin.source === 'local' ? plugin.enabled !== false : isPluginEnabled(settings, plugin.id)
}

export function PluginsSection({
  settings,
  onChangePluginEnabled,
  onChangePluginContributionEnabled,
}: {
  settings: Pick<AgentSettings, 'disabledPluginIds' | 'pluginContributions'>
  onChangePluginEnabled: (pluginId: string, enabled: boolean) => void
  onChangePluginContributionEnabled: (
    pluginId: string,
    contribution: PluginContribution,
    enabled: boolean,
  ) => void
}): JSX.Element {
  const { t } = useTranslation()
  const registry = usePluginRegistry()
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const returnPointRef = useRef<{ id: string; scrollTop: number } | null>(null)
  const activePlugin = registry.plugins.find(plugin => plugin.id === activePluginId) ?? null
  async function updateEnabled(plugin: PluginManifest, enabled: boolean): Promise<void> {
    if (plugin.source !== 'local') {
      onChangePluginEnabled(plugin.id, enabled)
      return
    }
    setPendingIds(current => new Set(current).add(plugin.id))
    setError(null)
    try {
      await changeInstalledPlugin('plugin.setEnabled', { pluginId: plugin.id, enabled })
    } catch (cause) {
      setError(pluginErrorMessage(cause))
    } finally {
      setPendingIds(current => {
        const next = new Set(current)
        next.delete(plugin.id)
        return next
      })
    }
  }

  useLayoutEffect(() => {
    const view = viewRef.current
    const scroller = view?.closest<HTMLElement>('.settings-panel__content')
    if (activePluginId) {
      if (scroller) {
        scroller.scrollTop = 0
      }
      view
        ?.querySelector<HTMLElement>('[data-plugin-detail-heading]')
        ?.focus({ preventScroll: true })
    } else if (returnPointRef.current) {
      if (scroller) {
        scroller.scrollTop = returnPointRef.current.scrollTop
      }
      view
        ?.querySelector<HTMLElement>(
          `[data-testid="settings-plugin-details-${returnPointRef.current.id}"]`,
        )
        ?.focus({ preventScroll: true })
      returnPointRef.current = null
    }
  }, [activePluginId])

  return (
    <div ref={viewRef} className="settings-plugins" id="settings-section-plugins">
      {error || registry.error ? (
        <p className="cove-window__error" role="alert">
          {error ?? registry.error}
        </p>
      ) : null}
      {activePlugin ? (
        <PluginSettingsDetail
          plugin={activePlugin}
          enabled={pluginEnabled(activePlugin, settings)}
          busy={pendingIds.has(activePlugin.id)}
          settings={settings}
          onChangeEnabled={enabled => {
            void updateEnabled(activePlugin, enabled)
          }}
          onChangeContribution={(contribution, enabled) =>
            onChangePluginContributionEnabled(activePlugin.id, contribution, enabled)
          }
          onBack={() => setActivePluginId(null)}
        />
      ) : (
        <SettingsGroup
          id="settings-plugins-installed"
          title={t('settingsPanel.plugins.installedTitle')}
          description={t('settingsPanel.plugins.installedHelp')}
        >
          <div className="settings-plugin-list__actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              onClick={() => {
                void refreshPluginRegistry()
              }}
              data-testid="settings-plugins-refresh"
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t('settingsPanel.plugins.refresh')}
            </button>
          </div>
          <SettingsGroupBody className="settings-plugin-list">
            {registry.plugins.map(plugin => {
              const enabled = pluginEnabled(plugin, settings)
              return (
                <article
                  className="settings-plugin"
                  id={`settings-plugin-${plugin.id}`}
                  data-testid={`settings-plugin-${plugin.id}`}
                  key={plugin.id}
                  aria-labelledby={`settings-plugin-name-${plugin.id}`}
                >
                  <button
                    type="button"
                    className="settings-plugin__open"
                    data-testid={`settings-plugin-details-${plugin.id}`}
                    aria-label={t('settingsPanel.plugins.details', { name: plugin.displayName })}
                    onClick={() => {
                      const scroller = viewRef.current?.closest<HTMLElement>(
                        '.settings-panel__content',
                      )
                      returnPointRef.current = {
                        id: plugin.id,
                        scrollTop: scroller?.scrollTop ?? 0,
                      }
                      setActivePluginId(plugin.id)
                    }}
                  >
                    <PluginSettingsGlyph pluginId={plugin.id} />
                    <span className="settings-plugin__identity">
                      <span className="settings-plugin__title">
                        <span
                          id={`settings-plugin-name-${plugin.id}`}
                          role="heading"
                          aria-level={4}
                        >
                          {plugin.displayName}
                        </span>
                        <span className="settings-plugin__version">{plugin.version}</span>
                      </span>
                      <span className="settings-plugin__description">
                        {pluginDescription(plugin, t)}
                      </span>
                      <span className="settings-plugin__byline">
                        {t(
                          `settingsPanel.plugins.${plugin.source === 'local' ? 'local' : 'builtIn'}`,
                        )}
                        {plugin.status === 'error' ? (
                          <span>{t('settingsPanel.plugins.runtime.failed')}</span>
                        ) : null}
                        {!enabled ? <span>{t('settingsPanel.plugins.disabled')}</span> : null}
                      </span>
                    </span>
                    <ChevronRight
                      className="settings-plugin__chevron"
                      size={15}
                      aria-hidden="true"
                    />
                  </button>
                  <PluginSettingsToggle
                    plugin={plugin}
                    enabled={enabled}
                    disabled={pendingIds.has(plugin.id)}
                    onChange={next => {
                      void updateEnabled(plugin, next)
                    }}
                  />
                </article>
              )
            })}
          </SettingsGroupBody>
        </SettingsGroup>
      )}
      <PluginDevelopmentGuide />
    </div>
  )
}
