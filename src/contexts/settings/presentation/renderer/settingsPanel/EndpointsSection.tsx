import React, { useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { SshConfigHost, WorkerEndpointOverviewDto } from '@shared/contracts/dto'
import { RemoteEndpointStatusPanel } from '@app/renderer/shell/components/RemoteEndpointStatusPanel'
import { useEndpointOverviews } from '@app/renderer/shell/hooks/useEndpointOverviews'
import { loadSshConfigHosts } from '@app/renderer/shell/utils/sshConfigHostsApi'
import { getEndpointActionExecution } from '@app/renderer/shell/utils/endpointOverviewUi'
import { notifyTopologyChanged } from '@app/renderer/shell/utils/topologyEvents'
import {
  buildManagedSshDraft,
  createEmptyEndpointFormDraft,
  isEndpointFormDirty,
  sshConfigHostToDraft,
  type EndpointFormDraft,
  type EndpointRegisterMode,
} from '../../../../topology/domain/endpointFormDraft'
import { parseOptionalManagedSshPort } from '../../../../topology/domain/managedSshPort'
import { EndpointsRegisterDialog } from './EndpointsRegisterDialog'
import { EndpointRemoveDialog } from './EndpointRemoveDialog'
import { toErrorMessage } from './workerSectionUtils'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

type EndpointDialogState = { kind: 'create' } | { kind: 'edit'; endpointId: string }

function parseRequiredPort(value: string): number | null {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    return null
  }

  const port = Math.floor(parsed)
  return port > 0 && port <= 65_535 ? port : null
}

export function EndpointsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    overviews,
    remoteOverviews,
    error: overviewError,
    isLoading,
    busyByEndpointId,
    reload,
    prepareEndpoint,
    repairEndpoint,
  } = useEndpointOverviews()
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [dialogState, setDialogState] = useState<EndpointDialogState>({ kind: 'create' })
  const [registerBusy, setRegisterBusy] = useState(false)
  const [removingEndpointId, setRemovingEndpointId] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<WorkerEndpointOverviewDto | null>(null)
  const [registerMode, setRegisterMode] = useState<EndpointRegisterMode>('managed')
  const [displayName, setDisplayName] = useState('')
  const [managedHost, setManagedHost] = useState('')
  const [managedPort, setManagedPort] = useState('')
  const [managedUsername, setManagedUsername] = useState('')
  const [managedRemotePort, setManagedRemotePort] = useState('')
  const [manualHostname, setManualHostname] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [formBaseline, setFormBaseline] = useState<EndpointFormDraft>(createEmptyEndpointFormDraft)
  const [localError, setLocalError] = useState<string | null>(null)

  const currentDraft: EndpointFormDraft = {
    registerMode,
    displayName,
    managedHost,
    managedPort,
    managedUsername,
    managedRemotePort,
    manualHostname,
    manualPort,
    manualToken,
  }

  const error = localError ?? overviewError
  const managedPortResult = parseOptionalManagedSshPort(managedPort)
  const managedRemotePortResult = parseOptionalManagedSshPort(managedRemotePort)
  const manualPortValue = parseRequiredPort(manualPort)
  const remoteEndpoints = remoteOverviews
  const existingManagedHosts = remoteEndpoints.flatMap(overview => {
    const access = overview.endpoint.access
    return access?.kind === 'managed_ssh' && access.managedSsh ? [access.managedSsh.host] : []
  })
  const persistenceOverview =
    overviews.find(
      overview =>
        overview.endpoint.endpointId === 'local' && overview.status === 'persistence_failed',
    ) ?? null

  const canSaveManaged =
    managedHost.trim().length > 0 &&
    managedPortResult.state !== 'invalid' &&
    managedRemotePortResult.state !== 'invalid' &&
    (dialogState.kind === 'create' || managedRemotePortResult.state === 'valid')
  const canRegisterManual =
    manualHostname.trim().length > 0 && manualPortValue !== null && manualToken.trim().length > 0

  const applyRegisterDraft = (draft: EndpointFormDraft): void => {
    setRegisterMode(draft.registerMode)
    setDisplayName(draft.displayName)
    setManagedHost(draft.managedHost)
    setManagedPort(draft.managedPort)
    setManagedUsername(draft.managedUsername)
    setManagedRemotePort(draft.managedRemotePort)
    setManualHostname(draft.manualHostname)
    setManualPort(draft.manualPort)
    setManualToken(draft.manualToken)
  }

  const resetRegisterForm = (): void => {
    const emptyDraft = createEmptyEndpointFormDraft()
    applyRegisterDraft(emptyDraft)
    setFormBaseline(emptyDraft)
    setDialogState({ kind: 'create' })
  }

  const openRegisterWindow = (): void => {
    const emptyDraft = createEmptyEndpointFormDraft()
    setLocalError(null)
    applyRegisterDraft(emptyDraft)
    setFormBaseline(emptyDraft)
    setDialogState({ kind: 'create' })
    setIsRegisterOpen(true)
  }

  const openEditWindow = (overview: WorkerEndpointOverviewDto): void => {
    const ssh = overview.endpoint.access?.managedSsh
    if (overview.endpoint.access?.kind !== 'managed_ssh' || !ssh) {
      return
    }

    const draft = buildManagedSshDraft({
      displayName: overview.endpoint.displayName,
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      remotePort: ssh.remotePort,
    })

    setLocalError(null)
    setDialogState({ kind: 'edit', endpointId: overview.endpoint.endpointId })
    applyRegisterDraft(draft)
    setFormBaseline(draft)
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

  const handleSave = async (): Promise<void> => {
    setLocalError(null)
    setRegisterBusy(true)

    try {
      if (registerMode === 'managed') {
        if (!canSaveManaged) {
          return
        }

        const payload = {
          displayName: displayName.trim().length > 0 ? displayName.trim() : null,
          host: managedHost.trim(),
          port: managedPortResult.value,
          username: managedUsername.trim().length > 0 ? managedUsername.trim() : null,
          remotePort: managedRemotePortResult.value,
          remotePlatform: 'auto' as const,
        }
        if (dialogState.kind === 'edit') {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'endpoint.updateManagedSsh',
            payload: { endpointId: dialogState.endpointId, ...payload },
          })
        } else {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'endpoint.registerManagedSsh',
            payload,
          })
        }
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

  const handleRemove = async (overview: WorkerEndpointOverviewDto): Promise<void> => {
    const endpointId = overview.endpoint.endpointId
    setLocalError(null)
    setRemovingEndpointId(endpointId)

    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'endpoint.remove',
        payload: { endpointId, expectedMountCount: overview.dependentMountCount },
      })
      setPendingRemoval(null)
      notifyTopologyChanged()
      await reload()
    } catch (caughtError) {
      setLocalError(toErrorMessage(caughtError))
    } finally {
      setRemovingEndpointId(null)
    }
  }

  return (
    <SettingsGroup
      id="settings-section-endpoints"
      title={t('settingsPanel.endpoints.title')}
      description={t('settingsPanel.endpoints.list.help')}
    >
      <SettingsGroupBody id="settings-section-endpoints-list">
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

        {persistenceOverview ? (
          <RemoteEndpointStatusPanel
            t={t}
            overview={persistenceOverview}
            compact
            isBusy={Boolean(busyByEndpointId.local)}
            onRunRecommendedAction={nextOverview => {
              void runRecommendedAction(nextOverview)
            }}
            testIdPrefix="settings-topology-persistence"
          />
        ) : null}

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
                    {overview.isManaged ? (
                      <button
                        type="button"
                        className="secondary"
                        data-testid={`settings-endpoints-edit-${overview.endpoint.endpointId}`}
                        disabled={isBusy || removingEndpointId === overview.endpoint.endpointId}
                        onClick={() => openEditWindow(overview)}
                      >
                        {t('common.edit')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary"
                      data-testid={`settings-endpoints-remove-${overview.endpoint.endpointId}`}
                      disabled={isBusy || removingEndpointId === overview.endpoint.endpointId}
                      onClick={() => {
                        setLocalError(null)
                        setPendingRemoval(overview)
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
      </SettingsGroupBody>

      {isRegisterOpen ? (
        <EndpointsRegisterDialog
          isOpen
          mode={dialogState.kind}
          error={error}
          isBusy={registerBusy}
          isDirty={isEndpointFormDirty(currentDraft, formBaseline)}
          registerMode={registerMode}
          displayName={displayName}
          managedHost={managedHost}
          managedUsername={managedUsername}
          managedPort={managedPort}
          managedRemotePort={managedRemotePort}
          manualHostname={manualHostname}
          manualPort={manualPort}
          manualToken={manualToken}
          canSubmit={registerMode === 'managed' ? canSaveManaged : canRegisterManual}
          managedPortInvalid={managedPortResult.state === 'invalid'}
          managedRemotePortInvalid={managedRemotePortResult.state === 'invalid'}
          existingManagedHosts={existingManagedHosts}
          isSshConfigImportDisabled={isLoading || overviewError !== null}
          loadSshConfigHosts={loadSshConfigHosts}
          onChangeRegisterMode={setRegisterMode}
          onChangeDisplayName={setDisplayName}
          onChangeManagedHost={setManagedHost}
          onChangeManagedUsername={setManagedUsername}
          onChangeManagedPort={setManagedPort}
          onChangeManagedRemotePort={setManagedRemotePort}
          onChangeManualHostname={setManualHostname}
          onChangeManualPort={setManualPort}
          onChangeManualToken={setManualToken}
          onSelectSshConfigHost={(host: SshConfigHost) => {
            applyRegisterDraft(sshConfigHostToDraft(host, existingManagedHosts))
          }}
          onCancel={closeRegisterWindow}
          onSubmit={() => {
            void handleSave()
          }}
        />
      ) : null}
      {pendingRemoval ? (
        <EndpointRemoveDialog
          displayName={pendingRemoval.endpoint.displayName}
          mountCount={pendingRemoval.dependentMountCount}
          isBusy={removingEndpointId === pendingRemoval.endpoint.endpointId}
          onCancel={() => {
            if (!removingEndpointId) {
              setPendingRemoval(null)
            }
          }}
          onConfirm={() => {
            void handleRemove(pendingRemoval)
          }}
        />
      ) : null}
    </SettingsGroup>
  )
}
