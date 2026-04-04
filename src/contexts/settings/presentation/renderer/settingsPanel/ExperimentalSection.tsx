import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { HomeWorkerConfigDto, WebsiteWindowPolicy, WorkerStatusResult } from '@shared/contracts/dto'
import { toErrorMessage } from './workerSectionUtils'

export function ExperimentalSection({
  websiteWindowPolicy,
  websiteWindowPasteEnabled,
  onChangeWebsiteWindowPolicy,
  onChangeWebsiteWindowPasteEnabled,
}: {
  websiteWindowPolicy: WebsiteWindowPolicy
  websiteWindowPasteEnabled: boolean
  onChangeWebsiteWindowPolicy: (policy: WebsiteWindowPolicy) => void
  onChangeWebsiteWindowPasteEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [keepAliveHostDraft, setKeepAliveHostDraft] = useState('')
  const [workerConfig, setWorkerConfig] = useState<HomeWorkerConfigDto | null>(null)
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusResult | null>(null)
  const [workerWebUiError, setWorkerWebUiError] = useState<string | null>(null)
  const [workerWebUiBusy, setWorkerWebUiBusy] = useState(false)

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

  const loadWorkerWebUiState = useCallback(async (): Promise<void> => {
    setWorkerWebUiError(null)

    try {
      const [config, status] = await Promise.all([
        window.opencoveApi.workerClient.getConfig(),
        window.opencoveApi.worker.getStatus(),
      ])

      setWorkerConfig(config)
      setWorkerStatus(status)
    } catch (caughtError) {
      setWorkerWebUiError(toErrorMessage(caughtError))
    }
  }, [])

  useEffect(() => {
    void loadWorkerWebUiState()
  }, [loadWorkerWebUiState])

  const workerWebUiStatusLabel = useMemo((): string => {
    if (!workerConfig || !workerStatus) {
      return t('common.loading')
    }

    if (workerConfig.mode !== 'local') {
      return t('settingsPanel.experimental.workerWebUi.status.requiresLocal')
    }

    return workerStatus.status === 'running' && workerStatus.connection
      ? t('settingsPanel.experimental.workerWebUi.status.running')
      : t('settingsPanel.experimental.workerWebUi.status.stopped')
  }, [t, workerConfig, workerStatus])

  const canOpenWorkerWebUi = useMemo((): boolean => {
    return Boolean(workerConfig?.mode === 'local' && workerStatus?.status === 'running' && workerStatus.connection)
  }, [workerConfig, workerStatus])

  const openWorkerWebUi = useCallback(async (): Promise<void> => {
    setWorkerWebUiError(null)
    setWorkerWebUiBusy(true)

    try {
      const url = await window.opencoveApi.worker.getWebUiUrl()
      if (!url) {
        setWorkerWebUiError(t('settingsPanel.experimental.workerWebUi.errors.noUrl'))
        return
      }

      window.open(url)
    } catch (caughtError) {
      setWorkerWebUiError(toErrorMessage(caughtError))
    } finally {
      setWorkerWebUiBusy(false)
    }
  }, [t])

  return (
    <div className="settings-panel__section" id="settings-section-experimental">
      <h3 className="settings-panel__section-title">{t('settingsPanel.experimental.title')}</h3>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.experimental.workerWebUi.title')}</h4>
          <span>{t('settingsPanel.experimental.workerWebUi.help')}</span>
        </div>

        {workerWebUiError ? (
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('common.error')}</strong>
            </div>
            <div className="settings-panel__control">
              <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
                {workerWebUiError}
              </span>
            </div>
          </div>
        ) : null}

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.workerWebUi.statusLabel')}</strong>
            <span>{t('settingsPanel.experimental.workerWebUi.statusHelp')}</span>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
            <span
              className="settings-panel__value"
              data-testid="settings-experimental-worker-web-ui-status"
            >
              {workerWebUiStatusLabel}
            </span>
            <button
              type="button"
              className="secondary"
              data-testid="settings-experimental-worker-web-ui-refresh"
              disabled={workerWebUiBusy}
              onClick={() => void loadWorkerWebUiState()}
            >
              {t('settingsPanel.experimental.workerWebUi.refresh')}
            </button>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.experimental.workerWebUi.actionsLabel')}</strong>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="primary"
              data-testid="settings-experimental-worker-web-ui-open"
              disabled={!canOpenWorkerWebUi || workerWebUiBusy}
              onClick={() => void openWorkerWebUi()}
            >
              {t('settingsPanel.experimental.workerWebUi.open')}
            </button>
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
