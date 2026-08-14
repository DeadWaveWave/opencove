import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { SshConfigHost } from '@shared/contracts/dto'
import { sshConfigHostToDraft } from '../../../../topology/domain/endpointFormDraft'
import { uniqueImportableSshConfigHosts } from '../../../../topology/domain/sshConfigHost'

type PickerState = 'closed' | 'loading' | 'ready' | 'error'

export function SshConfigHostPicker({
  existingManagedHosts,
  isBusy,
  loadHosts,
  onSelect,
}: {
  existingManagedHosts: readonly string[]
  isBusy: boolean
  loadHosts: () => Promise<SshConfigHost[]>
  onSelect: (host: SshConfigHost) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [pickerState, setPickerState] = React.useState<PickerState>('closed')
  const [hosts, setHosts] = React.useState<SshConfigHost[]>([])
  const requestGeneration = React.useRef(0)

  React.useEffect(
    () => () => {
      requestGeneration.current += 1
    },
    [],
  )

  const openPicker = async (): Promise<void> => {
    const generation = ++requestGeneration.current
    setPickerState('loading')
    setHosts([])

    try {
      const nextHosts = await loadHosts()
      if (generation !== requestGeneration.current) {
        return
      }
      setHosts(uniqueImportableSshConfigHosts(nextHosts))
      setPickerState('ready')
    } catch {
      if (generation !== requestGeneration.current) {
        return
      }
      setPickerState('error')
    }
  }

  return (
    <div className="cove-window__ssh-config-picker">
      <div className="cove-window__ssh-config-picker-header">
        <div className="cove-window__section-card-heading">
          <strong>{t('settingsPanel.endpoints.register.sshConfig.title')}</strong>
          <span>{t('settingsPanel.endpoints.register.sshConfig.help')}</span>
        </div>
        <button
          type="button"
          className="secondary"
          data-testid="settings-endpoints-ssh-config-open"
          disabled={isBusy || pickerState === 'loading'}
          onClick={() => {
            void openPicker()
          }}
        >
          {pickerState === 'loading'
            ? t('settingsPanel.endpoints.register.sshConfig.loading')
            : t('settingsPanel.endpoints.register.sshConfig.action')}
        </button>
      </div>

      {pickerState === 'error' ? (
        <p className="cove-window__error" data-testid="settings-endpoints-ssh-config-error">
          {t('settingsPanel.endpoints.register.sshConfig.readError')}
        </p>
      ) : null}

      {pickerState === 'ready' ? (
        hosts.length === 0 ? (
          <p
            className="cove-window__ssh-config-empty"
            data-testid="settings-endpoints-ssh-config-empty"
          >
            {t('settingsPanel.endpoints.register.sshConfig.empty')}
          </p>
        ) : (
          <div
            className="cove-window__ssh-config-list"
            data-testid="settings-endpoints-ssh-config-list"
          >
            {hosts.map(host => {
              const draft = sshConfigHostToDraft(host, existingManagedHosts)
              const hostName = host.hostName?.trim() ?? ''
              const user = host.user?.trim() ?? ''
              const summary =
                hostName && user
                  ? `${user}@${hostName}`
                  : hostName ||
                    (user
                      ? t('settingsPanel.endpoints.register.sshConfig.userSummary', { user })
                      : null)

              return (
                <button
                  key={host.alias.trim().toLowerCase()}
                  type="button"
                  className="cove-window__ssh-config-host"
                  data-testid={`settings-endpoints-ssh-config-host-${host.alias}`}
                  disabled={isBusy || draft.isAlreadyAdded}
                  onClick={() => {
                    requestGeneration.current += 1
                    setPickerState('closed')
                    onSelect(host)
                  }}
                >
                  <span className="cove-window__ssh-config-host-copy">
                    <strong>{draft.managedHost}</strong>
                    {summary ? <small>{summary}</small> : null}
                  </span>
                  {draft.isAlreadyAdded ? (
                    <span className="cove-window__ssh-config-added">
                      {t('settingsPanel.endpoints.register.sshConfig.alreadyAdded')}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )
      ) : null}
    </div>
  )
}
