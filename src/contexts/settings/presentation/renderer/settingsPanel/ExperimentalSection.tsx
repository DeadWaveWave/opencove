import React, { useCallback, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WebsiteWindowPolicy } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import {
  BROWSER_SEARCH_ENGINES,
  type BrowserSearchEngineId,
} from '@contexts/settings/domain/browserSettings'
import type { BrowserMode } from '@shared/contracts/dto'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function ExperimentalSection({
  websiteWindowPolicy,
  browserDefaultMode,
  browserSearchEngine,
  websiteWindowPasteEnabled,
  onChangeWebsiteWindowPolicy,
  onChangeBrowserDefaultMode,
  onChangeBrowserSearchEngine,
  onChangeWebsiteWindowPasteEnabled,
}: {
  websiteWindowPolicy: WebsiteWindowPolicy
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  websiteWindowPasteEnabled: boolean
  onChangeWebsiteWindowPolicy: (policy: WebsiteWindowPolicy) => void
  onChangeBrowserDefaultMode: (mode: BrowserMode) => void
  onChangeBrowserSearchEngine: (engine: BrowserSearchEngineId) => void
  onChangeWebsiteWindowPasteEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [keepAliveHostDraft, setKeepAliveHostDraft] = useState('')

  const updateWebsiteWindowPolicy = useCallback(
    (patch: Partial<WebsiteWindowPolicy>) => {
      onChangeWebsiteWindowPolicy({
        ...websiteWindowPolicy,
        ...patch,
      })
    },
    [onChangeWebsiteWindowPolicy, websiteWindowPolicy],
  )

  const removeKeepAliveHost = useCallback(
    (pattern: string) => {
      updateWebsiteWindowPolicy({
        keepAliveHosts: websiteWindowPolicy.keepAliveHosts.filter(item => item !== pattern),
      })
    },
    [updateWebsiteWindowPolicy, websiteWindowPolicy.keepAliveHosts],
  )

  const addKeepAliveHost = useCallback(() => {
    const normalized = keepAliveHostDraft.trim()
    if (normalized.length === 0) {
      return
    }

    if (websiteWindowPolicy.keepAliveHosts.includes(normalized)) {
      setKeepAliveHostDraft('')
      return
    }

    updateWebsiteWindowPolicy({
      keepAliveHosts: [...websiteWindowPolicy.keepAliveHosts, normalized].slice(0, 64),
    })
    setKeepAliveHostDraft('')
  }, [keepAliveHostDraft, updateWebsiteWindowPolicy, websiteWindowPolicy.keepAliveHosts])

  return (
    <SettingsGroup
      id="settings-section-experimental"
      title={t('settingsPanel.groups.advanced.websiteWindows')}
      description={t('settingsPanel.experimental.websiteWindowsHelp')}
    >
      <SettingsGroupBody id="settings-section-website-windows">
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.websiteWindowEnabledLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowEnabledHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <label className="cove-toggle">
              <input
                type="checkbox"
                data-testid="settings-experimental-website-window-enabled"
                checked={websiteWindowPolicy.enabled}
                aria-label={t('settingsPanel.experimental.websiteWindowEnabledLabel')}
                onChange={event =>
                  updateWebsiteWindowPolicy({
                    enabled: event.target.checked,
                  })
                }
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.websiteWindowDefaultModeLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowDefaultModeHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-website-window-default-mode"
              testId="settings-website-window-default-mode"
              ariaLabel={t('settingsPanel.experimental.websiteWindowDefaultModeLabel')}
              value={browserDefaultMode}
              disabled={!websiteWindowPolicy.enabled}
              options={[
                {
                  value: 'native',
                  label: t('settingsPanel.experimental.websiteWindowModeNative'),
                },
                {
                  value: 'iframe',
                  label: t('settingsPanel.experimental.websiteWindowModeIframe'),
                },
              ]}
              onChange={nextValue => onChangeBrowserDefaultMode(nextValue as BrowserMode)}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.browserSearchEngineLabel')}</strong>
            <span>{t('settingsPanel.experimental.browserSearchEngineHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-browser-search-engine"
              testId="settings-browser-search-engine"
              ariaLabel={t('settingsPanel.experimental.browserSearchEngineLabel')}
              value={browserSearchEngine}
              disabled={!websiteWindowPolicy.enabled}
              options={BROWSER_SEARCH_ENGINES.map(engine => ({
                value: engine,
                label: t(`settingsPanel.experimental.browserSearchEngine.${engine}`),
              }))}
              onChange={nextValue =>
                onChangeBrowserSearchEngine(nextValue as BrowserSearchEngineId)
              }
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.websiteWindowPasteLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowPasteHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <label className="cove-toggle">
              <input
                type="checkbox"
                data-testid="settings-experimental-website-window-paste"
                checked={websiteWindowPasteEnabled}
                disabled={!websiteWindowPolicy.enabled}
                aria-label={t('settingsPanel.experimental.websiteWindowPasteLabel')}
                onChange={event => onChangeWebsiteWindowPasteEnabled(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.websiteWindowMaxActiveLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowMaxActiveHelp')}</span>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
            <input
              id="settings-website-window-max-active"
              data-testid="settings-website-window-max-active"
              className="cove-field"
              style={{ width: '80px' }}
              type="number"
              aria-label={t('settingsPanel.experimental.websiteWindowMaxActiveLabel')}
              min={1}
              max={6}
              value={websiteWindowPolicy.maxActiveCount}
              disabled={!websiteWindowPolicy.enabled}
              onChange={event => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) {
                  return
                }
                updateWebsiteWindowPolicy({ maxActiveCount: next })
              }}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.websiteWindowDiscardAfterLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowDiscardAfterHelp')}</span>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
            <input
              id="settings-website-window-discard-after"
              data-testid="settings-website-window-discard-after"
              className="cove-field"
              style={{ width: '80px' }}
              type="number"
              aria-label={t('settingsPanel.experimental.websiteWindowDiscardAfterLabel')}
              min={1}
              max={240}
              value={websiteWindowPolicy.discardAfterMinutes}
              disabled={!websiteWindowPolicy.enabled}
              onChange={event => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) {
                  return
                }
                updateWebsiteWindowPolicy({ discardAfterMinutes: next })
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
              {t('common.minuteUnit')}
            </span>
          </div>
        </div>

        <div className="settings-panel__subsection">
          <div className="settings-panel__subsection-header">
            <strong>{t('settingsPanel.experimental.websiteWindowKeepAliveHostsLabel')}</strong>
            <span>{t('settingsPanel.experimental.websiteWindowKeepAliveHostsHelp')}</span>
          </div>

          <div
            className="settings-list-container"
            data-testid="settings-website-window-keep-alive-hosts"
          >
            {websiteWindowPolicy.keepAliveHosts.map(pattern => (
              <div className="settings-list-item" key={pattern}>
                <span className="settings-panel__value">{pattern}</span>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                  data-testid={`settings-website-keep-alive-remove-${pattern}`}
                  disabled={!websiteWindowPolicy.enabled}
                  onClick={() => removeKeepAliveHost(pattern)}
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>

          <div className="settings-panel__input-row">
            <input
              type="text"
              data-testid="settings-website-keep-alive-add-input"
              aria-label={t('settingsPanel.experimental.websiteWindowKeepAliveHostsPlaceholder')}
              className="cove-field"
              value={keepAliveHostDraft}
              disabled={!websiteWindowPolicy.enabled}
              placeholder={t('settingsPanel.experimental.websiteWindowKeepAliveHostsPlaceholder')}
              onChange={event => setKeepAliveHostDraft(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && addKeepAliveHost()}
            />
            <button
              type="button"
              className="primary"
              data-testid="settings-website-keep-alive-add-button"
              disabled={!websiteWindowPolicy.enabled || keepAliveHostDraft.trim().length === 0}
              onClick={() => addKeepAliveHost()}
            >
              {t('common.add')}
            </button>
          </div>
        </div>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
