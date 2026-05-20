import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { EndpointsSection } from './EndpointsSection'
import { ExperimentalWorkerWebUiSection } from './ExperimentalWorkerWebUiSection'
import { WorkerSection } from './WorkerSection'

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

      <div className="settings-panel__section" id="settings-section-worker-connections">
        <h3 className="settings-panel__section-title">
          {t('settingsPanel.workerConnections.title')}
        </h3>
        <span className="settings-panel__section-help">
          {t('settingsPanel.workerConnections.help')}
        </span>

        <div
          className="settings-panel__subsection"
          id="settings-section-experimental-remote-workers"
        >
          <div className="settings-panel__subsection-header">
            <strong>{t('settingsPanel.experimental.remoteWorkersTitle')}</strong>
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
      </div>

      {remoteWorkersEnabled ? (
        <EndpointsSection />
      ) : (
        <div className="settings-panel__section" id="settings-section-endpoints">
          <h3 className="settings-panel__section-title">{t('settingsPanel.endpoints.title')}</h3>
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
        </div>
      )}

      <ExperimentalWorkerWebUiSection />
    </>
  )
}
