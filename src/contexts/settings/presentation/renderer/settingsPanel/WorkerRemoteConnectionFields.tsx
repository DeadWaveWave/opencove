import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkerRemoteConnectionFields({
  hostname,
  port,
  token,
  revealToken,
  onHostnameChange,
  onPortChange,
  onTokenChange,
  onToggleRevealToken,
}: {
  hostname: string
  port: string
  token: string
  revealToken: boolean
  onHostnameChange: (hostname: string) => void
  onPortChange: (port: string) => void
  onTokenChange: (token: string) => void
  onToggleRevealToken: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.worker.remote.hostnameLabel')}</strong>
        </div>
        <div className="settings-panel__control">
          <input
            className="cove-field"
            style={{ width: '100%' }}
            type="text"
            aria-label={t('settingsPanel.worker.remote.hostnameLabel')}
            value={hostname}
            onChange={event => onHostnameChange(event.target.value)}
            data-testid="settings-worker-remote-hostname"
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.worker.remote.portLabel')}</strong>
        </div>
        <div className="settings-panel__control">
          <input
            className="cove-field"
            style={{ width: '120px' }}
            type="number"
            aria-label={t('settingsPanel.worker.remote.portLabel')}
            min={1}
            max={65_535}
            value={port}
            onChange={event => onPortChange(event.target.value)}
            data-testid="settings-worker-remote-port"
          />
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.worker.remote.tokenLabel')}</strong>
        </div>
        <div className="settings-panel__control" style={{ gap: 8 }}>
          <input
            className="cove-field"
            style={{ width: '100%', fontFamily: 'var(--cove-font-mono)' }}
            type={revealToken ? 'text' : 'password'}
            aria-label={t('settingsPanel.worker.remote.tokenLabel')}
            value={token}
            onChange={event => onTokenChange(event.target.value)}
            data-testid="settings-worker-remote-token"
          />
          <button
            type="button"
            className="secondary"
            onClick={onToggleRevealToken}
            data-testid="settings-worker-remote-token-toggle"
          >
            {revealToken
              ? t('settingsPanel.worker.remote.hideToken')
              : t('settingsPanel.worker.remote.revealToken')}
          </button>
        </div>
      </div>
    </>
  )
}
