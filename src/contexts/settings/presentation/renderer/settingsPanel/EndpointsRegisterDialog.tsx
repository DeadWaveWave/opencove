import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function EndpointsRegisterDialog({
  isOpen,
  error,
  isBusy,
  registerMode,
  displayName,
  managedHost,
  managedUsername,
  managedPort,
  managedRemotePort,
  manualHostname,
  manualPort,
  manualToken,
  canSubmit,
  onChangeRegisterMode,
  onChangeDisplayName,
  onChangeManagedHost,
  onChangeManagedUsername,
  onChangeManagedPort,
  onChangeManagedRemotePort,
  onChangeManualHostname,
  onChangeManualPort,
  onChangeManualToken,
  onCancel,
  onSubmit,
}: {
  isOpen: boolean
  error: string | null
  isBusy: boolean
  registerMode: 'managed' | 'manual'
  displayName: string
  managedHost: string
  managedUsername: string
  managedPort: string
  managedRemotePort: string
  manualHostname: string
  manualPort: string
  manualToken: string
  canSubmit: boolean
  onChangeRegisterMode: (value: 'managed' | 'manual') => void
  onChangeDisplayName: (value: string) => void
  onChangeManagedHost: (value: string) => void
  onChangeManagedUsername: (value: string) => void
  onChangeManagedPort: (value: string) => void
  onChangeManagedRemotePort: (value: string) => void
  onChangeManualHostname: (value: string) => void
  onChangeManualPort: (value: string) => void
  onChangeManualToken: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!isOpen) {
    return null
  }

  const description =
    registerMode === 'managed'
      ? t('settingsPanel.endpoints.register.managedHelp')
      : t('settingsPanel.endpoints.register.manualHelp')

  return (
    <div
      className="cove-window-backdrop"
      data-testid="settings-endpoints-register-backdrop"
      onClick={onCancel}
    >
      <section
        className="cove-window cove-window--wide"
        data-testid="settings-endpoints-register-window"
        onClick={event => event.stopPropagation()}
      >
        <h3>{t('settingsPanel.endpoints.register.title')}</h3>
        <p className="cove-window__intro">{t('settingsPanel.endpoints.register.help')}</p>

        <div className="cove-window__fields">
          {error ? (
            <p className="cove-window__error" data-testid="settings-endpoints-register-error">
              {error}
            </p>
          ) : null}

          <div className="cove-window__segmented" data-testid="settings-endpoints-register-mode">
            <button
              type="button"
              className={`cove-window__segment${registerMode === 'managed' ? ' cove-window__segment--selected' : ''}`}
              data-testid="settings-endpoints-register-mode-managed"
              disabled={isBusy}
              onClick={() => onChangeRegisterMode('managed')}
            >
              {t('settingsPanel.endpoints.register.managedLabel')}
            </button>
            <button
              type="button"
              className={`cove-window__segment${registerMode === 'manual' ? ' cove-window__segment--selected' : ''}`}
              data-testid="settings-endpoints-register-mode-manual"
              disabled={isBusy}
              onClick={() => onChangeRegisterMode('manual')}
            >
              {t('settingsPanel.endpoints.register.manualLabel')}
            </button>
          </div>

          <div className="cove-window__section-card">
            <div className="cove-window__section-card-heading">
              <strong>
                {registerMode === 'managed'
                  ? t('settingsPanel.endpoints.register.managedLabel')
                  : t('settingsPanel.endpoints.register.manualLabel')}
              </strong>
              <span>{description}</span>
            </div>

            <div className="cove-window__field-row">
              <label htmlFor="settings-endpoints-register-displayName">
                {t('settingsPanel.endpoints.register.displayNameLabel')}
              </label>
              <input
                id="settings-endpoints-register-displayName"
                className="cove-field"
                type="text"
                value={displayName}
                onChange={event => onChangeDisplayName(event.target.value)}
                data-testid="settings-endpoints-register-displayName"
                disabled={isBusy}
                placeholder={t('settingsPanel.endpoints.register.displayNamePlaceholder')}
              />
            </div>

            {registerMode === 'managed' ? (
              <div className="cove-window__field-grid">
                <div className="cove-window__field-row">
                  <label htmlFor="settings-endpoints-register-hostname">
                    {t('settingsPanel.endpoints.register.managedHostLabel')}
                  </label>
                  <input
                    id="settings-endpoints-register-hostname"
                    className="cove-field"
                    type="text"
                    value={managedHost}
                    onChange={event => onChangeManagedHost(event.target.value)}
                    data-testid="settings-endpoints-register-hostname"
                    disabled={isBusy}
                    placeholder={t('settingsPanel.endpoints.register.managedHostPlaceholder')}
                  />
                </div>

                <div className="cove-window__field-row">
                  <label htmlFor="settings-endpoints-register-username">
                    {t('settingsPanel.endpoints.register.managedUsernameLabel')}
                  </label>
                  <input
                    id="settings-endpoints-register-username"
                    className="cove-field"
                    type="text"
                    value={managedUsername}
                    onChange={event => onChangeManagedUsername(event.target.value)}
                    data-testid="settings-endpoints-register-username"
                    disabled={isBusy}
                    placeholder={t('settingsPanel.endpoints.register.managedUsernamePlaceholder')}
                  />
                </div>

                <div className="cove-window__field-row">
                  <label htmlFor="settings-endpoints-register-ssh-port">
                    {t('settingsPanel.endpoints.register.managedPortLabel')}
                  </label>
                  <input
                    id="settings-endpoints-register-ssh-port"
                    className="cove-field"
                    type="text"
                    inputMode="numeric"
                    value={managedPort}
                    onChange={event => onChangeManagedPort(event.target.value)}
                    data-testid="settings-endpoints-register-ssh-port"
                    disabled={isBusy}
                    placeholder={t('settingsPanel.endpoints.register.managedPortPlaceholder')}
                  />
                </div>

                <div className="cove-window__field-row">
                  <label htmlFor="settings-endpoints-register-remote-port">
                    {t('settingsPanel.endpoints.register.managedRemotePortLabel')}
                  </label>
                  <input
                    id="settings-endpoints-register-remote-port"
                    className="cove-field"
                    type="text"
                    inputMode="numeric"
                    value={managedRemotePort}
                    onChange={event => onChangeManagedRemotePort(event.target.value)}
                    data-testid="settings-endpoints-register-remote-port"
                    disabled={isBusy}
                    placeholder={t('settingsPanel.endpoints.register.managedRemotePortPlaceholder')}
                  />
                  <span className="cove-window__field-help">
                    {t('settingsPanel.endpoints.register.managedRemotePortHelp')}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="cove-window__field-grid">
                  <div className="cove-window__field-row">
                    <label htmlFor="settings-endpoints-register-manual-hostname">
                      {t('settingsPanel.endpoints.register.hostnameLabel')}
                    </label>
                    <input
                      id="settings-endpoints-register-manual-hostname"
                      className="cove-field"
                      type="text"
                      value={manualHostname}
                      onChange={event => onChangeManualHostname(event.target.value)}
                      data-testid="settings-endpoints-register-manual-hostname"
                      disabled={isBusy}
                      placeholder={t('settingsPanel.endpoints.register.managedHostPlaceholder')}
                    />
                  </div>

                  <div className="cove-window__field-row">
                    <label htmlFor="settings-endpoints-register-port">
                      {t('settingsPanel.endpoints.register.portLabel')}
                    </label>
                    <input
                      id="settings-endpoints-register-port"
                      className="cove-field"
                      type="text"
                      inputMode="numeric"
                      value={manualPort}
                      onChange={event => onChangeManualPort(event.target.value)}
                      data-testid="settings-endpoints-register-port"
                      disabled={isBusy}
                    />
                  </div>
                </div>

                <div className="cove-window__field-row">
                  <label htmlFor="settings-endpoints-register-token">
                    {t('settingsPanel.endpoints.register.tokenLabel')}
                  </label>
                  <input
                    id="settings-endpoints-register-token"
                    className="cove-field"
                    type="password"
                    value={manualToken}
                    onChange={event => onChangeManualToken(event.target.value)}
                    data-testid="settings-endpoints-register-token"
                    disabled={isBusy}
                  />
                  <span className="cove-window__field-help">
                    {t('settingsPanel.endpoints.register.tokenHelp')}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="cove-window__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="settings-endpoints-register-cancel"
            disabled={isBusy}
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            data-testid="settings-endpoints-register-submit"
            disabled={isBusy || !canSubmit}
            onClick={onSubmit}
          >
            {isBusy ? t('common.saving') : t('settingsPanel.endpoints.actions.add')}
          </button>
        </div>
      </section>
    </div>
  )
}