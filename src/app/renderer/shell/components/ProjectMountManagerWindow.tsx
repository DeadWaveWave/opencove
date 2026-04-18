import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type {
  CreateMountResult,
  ListMountsResult,
  ListWorkerEndpointsResult,
  MountDto,
  WorkerEndpointDto,
} from '@shared/contracts/dto'
import { toErrorMessage } from '../utils/format'
import { notifyTopologyChanged } from '../utils/topologyEvents'
import { basename, isAbsolutePath } from '../utils/pathHelpers'
import { ProjectMountManagerMountRow } from './ProjectMountManagerMountRow'
import { ProjectMountManagerRemoteSection } from './ProjectMountManagerRemoteSection'

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
  const [endpoints, setEndpoints] = useState<WorkerEndpointDto[]>([])
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

  const remoteEndpoints = useMemo(
    () => endpoints.filter(endpoint => endpoint.endpointId !== 'local'),
    [endpoints],
  )

  const endpointLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const endpoint of endpoints) {
      map.set(endpoint.endpointId, endpoint.displayName)
    }
    return map
  }, [endpoints])

  const reload = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      return
    }

    const [endpointResult, mountResult] = await Promise.all([
      remoteWorkersEnabled
        ? window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
            kind: 'query',
            id: 'endpoint.list',
            payload: null,
          })
        : Promise.resolve({ endpoints: [] }),
      window.opencoveApi.controlSurface.invoke<ListMountsResult>({
        kind: 'query',
        id: 'mount.list',
        payload: { projectId: workspaceId },
      }),
    ])

    setEndpoints(endpointResult.endpoints)
    setMounts(mountResult.mounts)
    setRemoteEndpointId(current => {
      const trimmed = current.trim()
      if (
        trimmed.length > 0 &&
        endpointResult.endpoints.some(endpoint => endpoint.endpointId === trimmed)
      ) {
        return trimmed
      }

      const firstRemote = endpointResult.endpoints.find(endpoint => endpoint.endpointId !== 'local')
      return firstRemote?.endpointId ?? ''
    })
  }, [remoteWorkersEnabled, workspaceId])

  useEffect(() => {
    void (async () => {
      setError(null)
      setIsBusy(true)
      try {
        await reload()
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      } finally {
        setIsBusy(false)
      }
    })()
  }, [reload])

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

  if (!workspace) {
    return null
  }

  const hasRemoteMounts = mounts.some(mount => mount.endpointId !== 'local')

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
      await reload()
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
      await reload()
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
      await reload()
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
      await reload()
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
          className="cove-window"
          data-testid="workspace-project-mount-manager-window"
          onClick={event => {
            event.stopPropagation()
          }}
        >
          <h3>{t('projectMountManager.title', { workspaceName: workspace.name })}</h3>
          <p>{t('projectMountManager.description')}</p>

          <div className="cove-window__fields">
            {error ? (
              <p className="cove-window__error" data-testid="workspace-project-mount-error">
                {error}
              </p>
            ) : null}

            {!remoteWorkersEnabled && hasRemoteMounts ? (
              <div
                style={{
                  border: '1px solid var(--cove-border-subtle)',
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
                data-testid="workspace-project-mount-remote-experimental-hint"
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {t('projectMountManager.remoteExperimentalTitle')}
                  </div>
                  <div style={{ color: 'var(--cove-text-muted)', fontSize: 12 }}>
                    {t('projectMountManager.remoteExperimentalHint')}
                  </div>
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

            <div className="cove-window__field-row">
              <label>{t('projectMountManager.listLabel')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                {mounts.length === 0 ? (
                  <div style={{ color: 'var(--cove-text-faint)', fontSize: 12 }}>
                    {t('projectMountManager.empty')}
                  </div>
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

            <div className="cove-window__field-row">
              <label>{t('projectMountManager.addLocalLabel')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
                  <input
                    className="cove-field"
                    type="text"
                    value={localRootPath}
                    onChange={event => setLocalRootPath(event.target.value)}
                    disabled={isBusy}
                    placeholder={t('projectMountManager.localRootPlaceholder')}
                    data-testid="workspace-project-mount-local-root"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="cove-window__action cove-window__action--ghost"
                    disabled={isBusy || !canBrowseLocal}
                    data-testid="workspace-project-mount-browse-local"
                    style={{ flexShrink: 0 }}
                    onClick={() => {
                      void browseLocalMount()
                    }}
                  >
                    {t('projectMountManager.browseLocalAction')}
                  </button>
                </div>
                <input
                  className="cove-field"
                  type="text"
                  value={localMountName}
                  onChange={event => setLocalMountName(event.target.value)}
                  disabled={isBusy}
                  placeholder={t('projectMountManager.localNamePlaceholder')}
                  data-testid="workspace-project-mount-local-name"
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  disabled={isBusy || localRootPath.trim().length === 0}
                  data-testid="workspace-project-mount-add-local"
                  onClick={() => {
                    void createLocalMount()
                  }}
                >
                  {t('common.add')}
                </button>
              </div>
            </div>

            {remoteWorkersEnabled ? (
              <ProjectMountManagerRemoteSection
                t={t}
                isBusy={isBusy}
                remoteEndpoints={remoteEndpoints}
                endpointLabelById={endpointLabelById}
                remoteEndpointId={remoteEndpointId}
                remoteRootPath={remoteRootPath}
                remoteMountName={remoteMountName}
                canCreateRemote={canCreateRemote}
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
                      await reload()
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
