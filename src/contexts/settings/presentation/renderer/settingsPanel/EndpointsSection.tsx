import React, { useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkerEndpointOverviewDto } from '@shared/contracts/dto'
import { RemoteEndpointStatusPanel } from '@app/renderer/shell/components/RemoteEndpointStatusPanel'
import { useEndpointOverviews } from '@app/renderer/shell/hooks/useEndpointOverviews'
import { getEndpointActionExecution } from '@app/renderer/shell/utils/endpointOverviewUi'
import { notifyTopologyChanged } from '@app/renderer/shell/utils/topologyEvents'
import { EndpointsRegisterDialog } from './EndpointsRegisterDialog'
import { toErrorMessage } from './workerSectionUtils'

type RegisterMode = 'managed' | 'manual'

function parseRequiredPort(value: string): number | null {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    return null
  }

  const port = Math.floor(parsed)
  return port > 0 && port <= 65_535 ? port : null
}

function parseOptionalPort(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return parseRequiredPort(trimmed)
}

export function EndpointsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    remoteOverviews,
    error: overviewError,
    isLoading,
    busyByEndpointId,
    reload,
    prepareEndpoint,
    repairEndpoint,
  } = useEndpointOverviews()
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [removingEndpointId, setRemovingEndpointId] = useState<string | null>(null)
  const [registerMode, setRegisterMode] = useState<RegisterMode>('managed')
  const [displayName, setDisplayName] = useState('')
  const [managedHost, setManagedHost] = useState('')
  const [managedPort, setManagedPort] = useState('')
  const [managedUsername, setManagedUsername] = useState('')
  const [managedRemotePort, setManagedRemotePort] = useState('')
  const [manualHostname, setManualHostname] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const error = localError ?? overviewError
  const managedPortValue = parseOptionalPort(managedPort)
  const managedRemotePortValue = parseOptionalPort(managedRemotePort)
  const manualPortValue = parseRequiredPort(manualPort)
  const remoteEndpoints = remoteOverviews

  const canRegisterManaged = managedHost.trim().length > 0 && managedPortValue !== 0
  const canRegisterManual =
    manualHostname.trim().length > 0 && manualPortValue !== null && manualToken.trim().length > 0

  const resetRegisterForm = (): void => {
    setRegisterMode('managed')
    setDisplayName('')
    setManagedHost('')
    setManagedPort('')
    setManagedUsername('')
    setManagedRemotePort('')
    setManualHostname('')
    setManualPort('')
    setManualToken('')
  }

  const openRegisterWindow = (): void => {
    setLocalError(null)
    resetRegisterForm()
    setIsRegisterOpen(true)
  }

  const closeRegisterWindow = (): void => {
    if (registerBusy) {
      return
    }

    setIsRegisterOpen(false)
    resetRegisterForm()
  }

  const runRecommendedAction = async (overview: WorkerEndpointOverviewDto): Promise<void> => {
    const action = getEndpointActionExecution(overview.recommendedAction)
    if (!action) {
      return
    }

    setLocalError(null)
    try {
      if (action.kind === 'prepare') {
        await prepareEndpoint({
          endpointId: overview.endpoint.endpointId,
          reason: action.reason,
        })
        return
      }

      await repairEndpoint({
        endpointId: overview.endpoint.endpointId,
        action: action.action,
      })
    } catch (caughtError) {
      setLocalError(toErrorMessage(caughtError))
    }
  }

  const handleReconnect = async (overview: WorkerEndpointOverviewDto): Promise<void> => {
    setLocalError(null)
    try {
      await prepareEndpoint({
        endpointId: overview.endpoint.endpointId,
        reason: 'reconnect',
      })
    } catch (caughtError) {
      setLocalError(toErrorMessage(caughtError))
    }
  }

  const handleRegister = async (): Promise<void> => {
    setLocalError(null)
    setRegisterBusy(true)

    try {
      if (registerMode === 'managed') {
        if (!canRegisterManaged) {
          return
        }

        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'endpoint.registerManagedSsh',
          payload: {
            displayName: displayName.trim().length > 0 ? displayName.trim() : null,
            host: managedHost.trim(),
            port: managedPortValue,
            username: managedUsername.trim().length > 0 ? managedUsername.trim() : null,
            remotePort: managedRemotePortValue,
            remotePlatform: 'auto',
          },
        })
      } else {
        if (!canRegisterManual) {
          return
        }

        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'endpoint.register',
          payload: {
            displayName: displayName.trim().length > 0 ? displayName.trim() : null,
            hostname: manualHostname.trim(),
            port: manualPortValue,
            token: manualToken.trim(),
          },
        })
      }

      closeRegisterWindow()
      notifyTopologyChanged()
      await reload()
    } catch (caughtError) {
      setLocalError(toErrorMessage(caughtError))
    } finally {
      setRegisterBusy(false)
    }
  }

  const handleRemove = async (endpointId: string): Promise<void> => {
    setLocalError(null)
    setRemovingEndpointId(endpointId)

    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'endpoint.remove',
        payload: { endpointId },
      })
      notifyTopologyChanged()
      await reload()
    } catch (caughtError) {
      setLocalError(toErrorMessage(caughtError))
    } finally {
      setRemovingEndpointId(null)
    }
  }

  return (
    <div className="settings-panel__section" id="settings-section-endpoints">
      <h3 className="settings-panel__section-title">{t('settingsPanel.endpoints.title')}</h3>

      {error ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('common.error')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
              {error}
            </span>
          </div>
        </div>
      ) : null}

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.endpoints.list.title')}
          </h4>
          <span>{t('settingsPanel.endpoints.list.help')}</span>
        </div>

        <div className="settings-panel__endpoint-toolbar">
          <div className="settings-panel__endpoint-toolbar-meta">
            <strong>
              {t('settingsPanel.endpoints.list.countLabel')}: {String(remoteEndpoints.length)}
            </strong>
            <span>{t('settingsPanel.endpoints.register.recommendedHint')}</span>
          </div>
          <div className="settings-panel__endpoint-toolbar-actions">
            <button
              type="button"
              className="secondary"
              data-testid="settings-endpoints-refresh"
              disabled={isLoading || registerBusy}
              onClick={() => {
                void reload()
              }}
            >
              {t('common.refresh')}
            </button>
            <button
              type="button"
              className="primary"
              data-testid="settings-endpoints-open-register"
              disabled={registerBusy}
              onClick={openRegisterWindow}
            >
              {t('settingsPanel.endpoints.actions.add')}
            </button>
          </div>
        </div>

        {remoteEndpoints.length === 0 ? (
          <div className="cove-window__empty-card">
            <div className="cove-window__section-card-heading">
              <strong>{t('settingsPanel.endpoints.register.recommendedTitle')}</strong>
              <span>{t('settingsPanel.endpoints.register.managedHelp')}</span>
            </div>
            <button
              type="button"
              className="primary"
              data-testid="settings-endpoints-empty-register"
              disabled={registerBusy}
              onClick={openRegisterWindow}
            >
              {t('settingsPanel.endpoints.actions.add')}
            </button>
          </div>
        ) : (
          <div className="settings-panel__endpoint-list">
            {remoteEndpoints.map(overview => {
              const isBusy = Boolean(busyByEndpointId[overview.endpoint.endpointId])

              return (
                <div key={overview.endpoint.endpointId} className="settings-panel__endpoint-card">
                  <RemoteEndpointStatusPanel
                    t={t}
                    overview={overview}
                    compact
                    isBusy={isBusy || removingEndpointId === overview.endpoint.endpointId}
                    onRunRecommendedAction={nextOverview => {
                      void runRecommendedAction(nextOverview)
                    }}
                    onReconnect={nextOverview => {
                      void handleReconnect(nextOverview)
                    }}
                  />

                  <div className="settings-panel__endpoint-card-actions">
                    <button
                      type="button"
                      className="secondary"
                      data-testid={`settings-endpoints-remove-${overview.endpoint.endpointId}`}
                      disabled={isBusy || removingEndpointId === overview.endpoint.endpointId}
                      onClick={() => {
                        void handleRemove(overview.endpoint.endpointId)
                      }}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <EndpointsRegisterDialog
        isOpen={isRegisterOpen}
        error={error}
        isBusy={registerBusy}
        registerMode={registerMode}
        displayName={displayName}
        managedHost={managedHost}
        managedUsername={managedUsername}
        managedPort={managedPort}
        managedRemotePort={managedRemotePort}
        manualHostname={manualHostname}
        manualPort={manualPort}
        manualToken={manualToken}
        canSubmit={registerMode === 'managed' ? canRegisterManaged : canRegisterManual}
        onChangeRegisterMode={setRegisterMode}
        onChangeDisplayName={setDisplayName}
        onChangeManagedHost={setManagedHost}
        onChangeManagedUsername={setManagedUsername}
        onChangeManagedPort={setManagedPort}
        onChangeManagedRemotePort={setManagedRemotePort}
        onChangeManualHostname={setManualHostname}
        onChangeManualPort={setManualPort}
        onChangeManualToken={setManualToken}
        onCancel={closeRegisterWindow}
        onSubmit={() => {
          void handleRegister()
        }}
      />
    </div>
  )
}
