import React from 'react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { Check, Network, Plus, Server, Terminal, X } from 'lucide-react'
import { Button } from '@app/renderer/components/ui/Button'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { useTranslation } from '@app/renderer/i18n'
import '@app/renderer/styles/settings-panel.endpoint-dialog.css'
import type { SshConfigHost } from '@shared/contracts/dto'
import { SshConfigHostPicker } from './SshConfigHostPicker'

export function EndpointsRegisterDialog({
  isOpen,
  mode,
  error,
  isBusy,
  isDirty,
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
  managedPortInvalid,
  managedRemotePortInvalid,
  existingManagedHosts = [],
  isSshConfigImportDisabled = false,
  loadSshConfigHosts,
  onChangeRegisterMode,
  onChangeDisplayName,
  onChangeManagedHost,
  onChangeManagedUsername,
  onChangeManagedPort,
  onChangeManagedRemotePort,
  onChangeManualHostname,
  onChangeManualPort,
  onChangeManualToken,
  onSelectSshConfigHost,
  onCancel,
  onSubmit,
  returnFocus,
}: {
  isOpen: boolean
  mode: 'create' | 'edit'
  error: string | null
  isBusy: boolean
  isDirty: boolean
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
  managedPortInvalid: boolean
  managedRemotePortInvalid: boolean
  existingManagedHosts?: readonly string[]
  isSshConfigImportDisabled?: boolean
  loadSshConfigHosts?: () => Promise<SshConfigHost[]>
  onChangeRegisterMode: (value: 'managed' | 'manual') => void
  onChangeDisplayName: (value: string) => void
  onChangeManagedHost: (value: string) => void
  onChangeManagedUsername: (value: string) => void
  onChangeManagedPort: (value: string) => void
  onChangeManagedRemotePort: (value: string) => void
  onChangeManualHostname: (value: string) => void
  onChangeManualPort: (value: string) => void
  onChangeManualToken: (value: string) => void
  onSelectSshConfigHost?: (host: SshConfigHost) => void
  onCancel: () => void
  onSubmit: () => void
  returnFocus?: React.RefObject<HTMLElement | null> | false
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(
    () => mode === 'edit' && (managedPort.trim().length > 0 || managedRemotePort.trim().length > 0),
  )

  if (!isOpen) {
    return null
  }

  const description =
    registerMode === 'managed'
      ? t('settingsPanel.endpoints.register.managedHelp')
      : t('settingsPanel.endpoints.register.manualHelp')
  const title =
    mode === 'edit'
      ? t('settingsPanel.endpoints.edit.title')
      : t('settingsPanel.endpoints.register.title')

  return (
    <Dialog
      open
      aria-label={title}
      backdropClassName="cove-window-backdrop"
      backdropTestId="settings-endpoints-register-backdrop"
      dismissOnEscape={!isBusy}
      returnFocus={returnFocus}
      onDismiss={reason => {
        if (!isBusy && (reason === 'escape' || !isDirty)) {
          onCancel()
        }
      }}
    >
      <section
        className="cove-window settings-endpoint-dialog"
        data-testid="settings-endpoints-register-window"
      >
        <header className="settings-endpoint-dialog__header">
          <Server size={18} aria-hidden="true" />
          <h3>{title}</h3>
          <IconButton label={t('common.close')} disabled={isBusy} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="cove-window__fields">
          {error ? (
            <p className="cove-window__error" data-testid="settings-endpoints-register-error">
              {error}
            </p>
          ) : null}

          {mode === 'create' ? (
            <SegmentedControl
              className="settings-endpoint-dialog__modes"
              testId="settings-endpoints-register-mode"
              size="md"
              label={t('settingsPanel.endpoints.register.modeLabel')}
              value={registerMode}
              disabled={isBusy}
              options={[
                {
                  value: 'managed',
                  label: t('settingsPanel.endpoints.register.managedLabel'),
                  icon: <Terminal />,
                  testId: 'settings-endpoints-register-mode-managed',
                },
                {
                  value: 'manual',
                  label: t('settingsPanel.endpoints.register.manualLabel'),
                  icon: <Network />,
                  testId: 'settings-endpoints-register-mode-manual',
                },
              ]}
              onValueChange={onChangeRegisterMode}
            />
          ) : null}

          <div className="settings-endpoint-dialog__form">
            <p className="settings-endpoint-dialog__description">
              {mode === 'edit' ? t('settingsPanel.endpoints.edit.help') : description}
            </p>

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
              <>
                {mode === 'create' && loadSshConfigHosts && onSelectSshConfigHost ? (
                  <SshConfigHostPicker
                    existingManagedHosts={existingManagedHosts}
                    isBusy={isBusy || isSshConfigImportDisabled}
                    loadHosts={loadSshConfigHosts}
                    onSelect={onSelectSshConfigHost}
                  />
                ) : null}

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
                </div>

                <details
                  className="cove-window__advanced"
                  data-testid="settings-endpoints-register-advanced"
                  open={isAdvancedOpen}
                  onToggle={event => setIsAdvancedOpen(event.currentTarget.open)}
                >
                  <summary
                    className="cove-window__advanced-summary"
                    data-testid="settings-endpoints-register-advanced-toggle"
                  >
                    <span>{t('settingsPanel.endpoints.register.advancedLabel')}</span>
                    <small>{t('settingsPanel.endpoints.register.advancedHelp')}</small>
                  </summary>
                  <div className="cove-window__field-grid cove-window__advanced-fields">
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
                      {managedPortInvalid ? (
                        <span
                          className="cove-window__error"
                          data-testid="settings-endpoints-register-ssh-port-error"
                        >
                          {t('settingsPanel.endpoints.register.portInvalid')}
                        </span>
                      ) : null}
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
                        placeholder={t(
                          'settingsPanel.endpoints.register.managedRemotePortPlaceholder',
                        )}
                      />
                      <span className="cove-window__field-help">
                        {t('settingsPanel.endpoints.register.managedRemotePortHelp')}
                      </span>
                      {managedRemotePortInvalid ? (
                        <span
                          className="cove-window__error"
                          data-testid="settings-endpoints-register-remote-port-error"
                        >
                          {t('settingsPanel.endpoints.register.portInvalid')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </details>
              </>
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
          <Button
            variant="ghost"
            data-testid="settings-endpoints-register-cancel"
            disabled={isBusy}
            onClick={onCancel}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={isBusy}
            data-testid="settings-endpoints-register-submit"
            disabled={isBusy || !canSubmit}
            onClick={onSubmit}
          >
            {mode === 'edit' ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {isBusy
              ? t('common.saving')
              : mode === 'edit'
                ? t('common.save')
                : t('settingsPanel.endpoints.actions.add')}
          </Button>
        </div>
      </section>
    </Dialog>
  )
}
