import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { createBuiltinPluginRegistry } from '@contexts/plugins/application/pluginRegistry'
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

const registry = createBuiltinPluginRegistry()

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
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const returnPointRef = useRef<{ id: string; scrollTop: number } | null>(null)
  const activePlugin = activePluginId ? registry.get(activePluginId) : null

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
      {activePlugin ? (
        <PluginSettingsDetail
          plugin={activePlugin}
          enabled={isPluginEnabled(settings, activePlugin.id)}
          settings={settings}
          onChangeEnabled={enabled => onChangePluginEnabled(activePlugin.id, enabled)}
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
          <SettingsGroupBody className="settings-plugin-list">
            {registry.list().map(plugin => {
              const enabled = isPluginEnabled(settings, plugin.id)
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
                        {t('settingsPanel.plugins.builtIn')}
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
                    onChange={next => onChangePluginEnabled(plugin.id, next)}
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
