import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { EndpointsSection } from './EndpointsSection'
import { ExperimentalWorkerWebUiSection } from './ExperimentalWorkerWebUiSection'
import { WorkerSection } from './WorkerSection'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function WorkerConnectionsSection({
  remoteWorkersEnabled,
  onChangeRemoteWorkersEnabled,
}: {
  remoteWorkersEnabled: boolean
  onChangeRemoteWorkersEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <WorkerSection remoteWorkersEnabled={remoteWorkersEnabled} />

      <SettingsGroup
        id="settings-section-worker-connections"
        title={t('settingsPanel.groups.worker.remote')}
        description={t('settingsPanel.workerConnections.help')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row" id="settings-section-experimental-remote-workers">
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
                  aria-label={t('settingsPanel.experimental.remoteWorkersEnabledLabel')}
                  onChange={event => onChangeRemoteWorkersEnabled(event.target.checked)}
                />
                <span className="cove-toggle__slider"></span>
              </label>
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>

      {remoteWorkersEnabled ? (
        <EndpointsSection />
      ) : (
        <SettingsGroup id="settings-section-endpoints" title={t('settingsPanel.endpoints.title')}>
          <SettingsGroupBody>
            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.endpoints.list.title')}</strong>
                <span>{t('settingsPanel.workerConnections.endpointsDisabledHelp')}</span>
              </div>
              <div className="settings-panel__control">
                <span className="settings-panel__value">
                  {t('settingsPanel.workerConnections.endpointsDisabledValue')}
                </span>
              </div>
            </div>
          </SettingsGroupBody>
        </SettingsGroup>
      )}

      <ExperimentalWorkerWebUiSection />
    </>
  )
}
