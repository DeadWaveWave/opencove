import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { CreateMountResult, ListMountsResult, MountDto } from '@shared/contracts/dto'
import { toErrorMessage } from '../utils/format'
import { notifyTopologyChanged } from '../utils/topologyEvents'
import { basename, isAbsolutePath } from '../utils/pathHelpers'
import { useEndpointOverviews } from '../hooks/useEndpointOverviews'
import { RemoteEndpointStatusSlot } from './RemoteEndpointStatusSlot'
import { ProjectMountManagerLocalSection } from './ProjectMountManagerLocalSection'
import { ProjectMountManagerMountRow } from './ProjectMountManagerMountRow'
import { ProjectMountManagerRemoteSection } from './ProjectMountManagerRemoteSection'
import { getEndpointActionExecution } from '../utils/endpointOverviewUi'

export function ProjectMountManagerWindow({
  workspace,
  remoteWorkersEnabled,
  onClose,
  onRequestOpenEndpoints,
}: {
  workspace: WorkspaceState | null
  remoteWorkersEnabled: boolean
  onClose: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const {
    remoteOverviews,
    overviewByEndpointId,
    error: endpointError,
    busyByEndpointId,
    reload: reloadEndpoints,
    prepareEndpoint,
    repairEndpoint,
  } = useEndpointOverviews({ enabled: remoteWorkersEnabled })
  const [mounts, setMounts] = useState<MountDto[]>([])
  const [homeWorkerMode, setHomeWorkerMode] = useState<'standalone' | 'local' | 'remote' | null>(
    null,
  )
  const [localRootPath, setLocalRootPath] = useState('')
  const [localMountName, setLocalMountName] = useState('')
  const [remoteEndpointId, setRemoteEndpointId] = useState<string>('')
  const [remoteRootPath, setRemoteRootPath] = useState('')
  const [remoteMountName, setRemoteMountName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const workspaceId = workspace?.id ?? null

  const endpointLabelById = useMemo(() => {
    const map = new Map<string, string>()
    map.set('local', 'Local')
    for (const overview of remoteOverviews) {
      map.set(overview.endpoint.endpointId, overview.endpoint.displayName)
    }
    return map
  }, [remoteOverviews])

  const reloadMounts = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      return
    }

    const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: workspaceId },
    })

    setMounts(mountResult.mounts)
  }, [workspaceId])

  useEffect(() => {
    void (async () => {
      setError(null)
      setIsBusy(true)
      try {
        await reloadMounts()
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      } finally {
        setIsBusy(false)
      }
    })()
  }, [reloadMounts])

  useEffect(() => {
    if (!remoteWorkersEnabled) {
      setRemoteEndpointId('')
      return
    }

    setRemoteEndpointId(current => {
      const trimmed = current.trim()
      if (
        trimmed.length > 0 &&
        remoteOverviews.some(overview => overview.endpoint.endpointId === trimmed)
      ) {
        return trimmed
      }

      return remoteOverviews[0]?.endpoint.endpointId ?? ''
    })
  }, [remoteOverviews, remoteWorkersEnabled])

  useEffect(() => {
    void (async () => {
      try {
        const config = await window.opencoveApi.workerClient.getConfig()
        setHomeWorkerMode(config.mode)
      } catch {
        setHomeWorkerMode(null)
      }
    })()
  }, [])

  const runRemoteEndpointAction = useCallback(
    async (endpointId: string) => {
      const overview = overviewByEndpointId.get(endpointId) ?? null
      if (!overview) {
        return
      }

      const action = getEndpointActionExecution(overview.recommendedAction)
      if (!action) {
        return
      }

      setError(null)
      try {
        if (action.kind === 'prepare') {
          await prepareEndpoint({ endpointId, reason: action.reason })
          return
        }

        await repairEndpoint({ endpointId, action: action.action })
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    },
    [overviewByEndpointId, prepareEndpoint, repairEndpoint],
  )

  const reconnectRemoteEndpoint = useCallback(
    async (endpointId: string) => {
      setError(null)
      try {
        await prepareEndpoint({ endpointId, reason: 'reconnect' })
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    },
    [prepareEndpoint],
  )

  if (!workspace) {
    return null
  }

  const hasRemoteMounts = mounts.some(mount => mount.endpointId !== 'local')
  const remoteEndpoint = overviewByEndpointId.get(remoteEndpointId.trim()) ?? null
  const displayError = error ?? endpointError

  const canBrowseLocal =
    typeof window !== 'undefined' &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    homeWorkerMode !== 'remote'

  const createLocalMount = async (): Promise<void> => {
    const rootPath = localRootPath.trim()

    if (rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('projectMountManager.localPathMustBeAbsolute'))
      return
    }

    const normalizedName = localMountName.trim()
    const fallbackName = basename(rootPath).trim()
    const name =
      normalizedName.length > 0 ? normalizedName : fallbackName.length > 0 ? fallbackName : null

    setError(null)
    setIsBusy(true)
    try {
      await window.opencoveApi.controlSurface.invoke<CreateMountResult>({
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId: workspace.id,
          endpointId: 'local',
          rootPath,
          name,
        },
      })

      setLocalRootPath('')
      setLocalMountName('')
      await reloadMounts()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const browseLocalMount = async (): Promise<void> => {
    if (!canBrowseLocal) {
      return
    }

    setError(null)
    setIsBusy(true)
    try {
      const selected = await window.opencoveApi.workspace.selectDirectory()
      if (!selected) {
        return
      }

      setLocalRootPath(selected.path)
      if (localMountName.trim().length === 0) {
        setLocalMountName(selected.name)
      }
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const createRemoteMount = async (): Promise<void> => {
    const endpointId = remoteEndpointId.trim()
    const rootPath = remoteRootPath.trim()
    if (endpointId.length === 0 || rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('projectMountManager.remotePathMustBeAbsolute'))
      return
    }

    const normalizedName = remoteMountName.trim()
    const fallbackName = basename(rootPath).trim()
    const resolvedName =
      normalizedName.length > 0 ? normalizedName : fallbackName.length > 0 ? fallbackName : null

    setError(null)
    setIsBusy(true)
    try {
      await window.opencoveApi.controlSurface.invoke<CreateMountResult>({
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId: workspace.id,
          endpointId,
          rootPath,
          name: resolvedName,
        },
      })

      setRemoteRootPath('')
      setRemoteMountName('')
      await reloadMounts()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const removeMount = async (mountId: string): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'mount.remove',
        payload: { mountId },
      })
      await reloadMounts()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const promoteMount = async (mountId: string): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'mount.promote',
        payload: { mountId },
      })
      await reloadMounts()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const canCreateRemote = remoteEndpointId.trim().length > 0 && remoteRootPath.trim().length > 0
  const handleRemoveMount = (mountId: string) => {
    void removeMount(mountId)
  }
  const handlePromoteMount = (mountId: string) => {
    void promoteMount(mountId)
  }

  return (
    <>
      <div
        className="cove-window-backdrop"
        data-testid="workspace-project-mount-manager-backdrop"
        onClick={() => {
          if (isBusy) {
            return
          }

          onClose()
        }}
      >
        <section
          className="cove-window cove-window--xwide"
          data-testid="workspace-project-mount-manager-window"
          onClick={event => {
            event.stopPropagation()
          }}
        >
          <h3>{t('projectMountManager.title', { workspaceName: workspace.name })}</h3>
          <p className="cove-window__intro">{t('projectMountManager.description')}</p>

          <div className="cove-window__fields">
            {displayError ? (
              <p className="cove-window__error" data-testid="workspace-project-mount-error">
                {displayError}
              </p>
            ) : null}

            {!remoteWorkersEnabled && hasRemoteMounts ? (
              <div
                className="cove-window__empty-card"
                data-testid="workspace-project-mount-remote-experimental-hint"
              >
                <div className="cove-window__section-card-heading">
                  <strong>{t('projectMountManager.remoteExperimentalTitle')}</strong>
                  <span>{t('projectMountManager.remoteExperimentalHint')}</span>
                </div>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  disabled={isBusy}
                  data-testid="workspace-project-mount-open-experimental"
                  onClick={() => {
                    onRequestOpenEndpoints()
                  }}
                >
                  {t('projectMountManager.openExperimentalAction')}
                </button>
              </div>
            ) : null}

            <div className="cove-window__section-card cove-window__section-card--subtle">
              <div className="cove-window__section-card-heading">
                <strong>{t('projectMountManager.listLabel')}</strong>
              </div>
              <div className="cove-window__stack cove-window__stack--tight">
                {mounts.length === 0 ? (
                  <div className="cove-window__field-help">{t('projectMountManager.empty')}</div>
                ) : (
                  mounts.map((mount, index) => (
                    <ProjectMountManagerMountRow
                      key={mount.mountId}
                      mount={mount}
                      endpointLabel={endpointLabelById.get(mount.endpointId) ?? mount.endpointId}
                      isDefault={index === 0}
                      isBusy={isBusy}
                      actionsDisabled={!remoteWorkersEnabled && mount.endpointId !== 'local'}
                      onPromote={handlePromoteMount}
                      onRemove={handleRemoveMount}
                    />
                  ))
                )}
              </div>
            </div>

            <ProjectMountManagerLocalSection
              t={t}
              isBusy={isBusy}
              canBrowseLocal={canBrowseLocal}
              localRootPath={localRootPath}
              localMountName={localMountName}
              onChangeLocalRootPath={setLocalRootPath}
              onChangeLocalMountName={setLocalMountName}
              onBrowseLocal={() => {
                void browseLocalMount()
              }}
              onCreateLocal={() => {
                void createLocalMount()
              }}
            />

            {remoteWorkersEnabled ? (
              <ProjectMountManagerRemoteSection
                t={t}
                isBusy={isBusy}
                remoteEndpoints={remoteOverviews.map(overview => overview.endpoint)}
                endpointLabelById={endpointLabelById}
                remoteEndpointId={remoteEndpointId}
                remoteRootPath={remoteRootPath}
                remoteMountName={remoteMountName}
                canCreateRemote={canCreateRemote}
                remoteStatusSlot={
                  <RemoteEndpointStatusSlot
                    t={t}
                    overview={remoteEndpoint}
                    busyByEndpointId={busyByEndpointId}
                    compact
                    showIdentity={false}
                    testIdPrefix="workspace-project-mount-remote-status"
                    onRunAction={endpointId => {
                      void runRemoteEndpointAction(endpointId)
                    }}
                    onReconnect={endpointId => {
                      void reconnectRemoteEndpoint(endpointId)
                    }}
                  />
                }
                onChangeRemoteEndpointId={setRemoteEndpointId}
                onChangeRemoteRootPath={setRemoteRootPath}
                onChangeRemoteMountName={setRemoteMountName}
                onCreateRemoteMount={() => {
                  void createRemoteMount()
                }}
                onRefresh={() => {
                  void (async () => {
                    setError(null)
                    setIsBusy(true)
                    try {
                      await reloadMounts()
                      await reloadEndpoints()
                    } catch (caughtError) {
                      setError(toErrorMessage(caughtError))
                    } finally {
                      setIsBusy(false)
                    }
                  })()
                }}
                onRequestOpenEndpoints={onRequestOpenEndpoints}
              />
            ) : null}
          </div>

          <div className="cove-window__actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              data-testid="workspace-project-mount-close"
              onClick={() => {
                onClose()
              }}
            >
              {t('common.close')}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
