import React, { useCallback, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WebsiteWindowPolicy } from '@shared/contracts/dto'
import { ExperimentalWorkerWebUiSection } from './ExperimentalWorkerWebUiSection'

export function ExperimentalSection({
  websiteWindowPolicy,
  websiteWindowPasteEnabled,
  remoteWorkersEnabled,
  onChangeWebsiteWindowPolicy,
  onChangeWebsiteWindowPasteEnabled,
  onChangeRemoteWorkersEnabled,
}: {
  websiteWindowPolicy: WebsiteWindowPolicy
  websiteWindowPasteEnabled: boolean
  remoteWorkersEnabled: boolean
  onChangeWebsiteWindowPolicy: (policy: WebsiteWindowPolicy) => void
  onChangeWebsiteWindowPasteEnabled: (enabled: boolean) => void
  onChangeRemoteWorkersEnabled: (enabled: boolean) => void
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
    <div className="settings-panel__section" id="settings-section-experimental">
      <h3 className="settings-panel__section-title">{t('settingsPanel.experimental.title')}</h3>

      <ExperimentalWorkerWebUiSection />

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.experimental.remoteWorkersTitle')}
          </h4>
          <span>{t('settingsPanel.experimental.remoteWorkersHelp')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.remoteWorkersEnabledLabel')}</strong>
            <span>{t('settingsPanel.experimental.remoteWorkersEnabledHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <label className="cove-toggle">
              <input
                type="checkbox"
                data-testid="settings-experimental-remote-workers-enabled"
                checked={remoteWorkersEnabled}
                onChange={event => onChangeRemoteWorkersEnabled(event.target.checked)}
              />
              <span className="cove-toggle__slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.experimental.websiteWindowsTitle')}
          </h4>
          <span>{t('settingsPanel.experimental.websiteWindowsHelp')}</span>
        </div>

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
      </div>
    </div>
  )
}
