import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
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

function toEndpointLabel(endpoint: WorkerEndpointDto): string {
  return endpoint.displayName
}

export function ProjectMountManagerWindow({
  workspace,
  onClose,
}: {
  workspace: WorkspaceState | null
  onClose: () => void
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
      map.set(endpoint.endpointId, toEndpointLabel(endpoint))
    }
    return map
  }, [endpoints])

  const reload = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      return
    }

    const [endpointResult, mountResult] = await Promise.all([
      window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
        kind: 'query',
        id: 'endpoint.list',
        payload: null,
      }),
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
  }, [workspaceId])

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

  const canBrowseLocal =
    typeof window !== 'undefined' &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    homeWorkerMode !== 'remote'

  const createLocalMount = async (): Promise<void> => {
    const rootPath = localRootPath.trim()
    const name = localMountName.trim().length > 0 ? localMountName.trim() : null

    if (rootPath.length === 0) {
      return
    }

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
          name: remoteMountName.trim().length > 0 ? remoteMountName.trim() : null,
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

  const canCreateRemote = remoteEndpointId.trim().length > 0 && remoteRootPath.trim().length > 0

  return (
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
            <p
              className="workspace-task-creator__error"
              data-testid="workspace-project-mount-error"
            >
              {error}
            </p>
          ) : null}

          <div className="cove-window__field-row">
            <label>{t('projectMountManager.listLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {mounts.length === 0 ? (
                <div style={{ color: 'var(--cove-text-faint)', fontSize: 12 }}>
                  {t('projectMountManager.empty')}
                </div>
              ) : (
                mounts.map(mount => (
                  <div
                    key={mount.mountId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      border: '1px solid var(--cove-border-subtle)',
                      background: 'var(--cove-field)',
                      borderRadius: 12,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cove-text)' }}>
                        {mount.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
                        {endpointLabelById.get(mount.endpointId) ?? mount.endpointId} ·{' '}
                        {mount.rootPath}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cove-window__action cove-window__action--danger"
                      disabled={isBusy}
                      data-testid={`workspace-project-mount-remove-${mount.mountId}`}
                      onClick={() => {
                        void removeMount(mount.mountId)
                      }}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="cove-window__field-row">
            <label>{t('projectMountManager.addLocalLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <input
                className="cove-field"
                type="text"
                value={localRootPath}
                onChange={event => setLocalRootPath(event.target.value)}
                disabled={isBusy}
                placeholder={t('projectMountManager.localRootPlaceholder')}
                data-testid="workspace-project-mount-local-root"
              />
              <input
                className="cove-field"
                type="text"
                value={localMountName}
                onChange={event => setLocalMountName(event.target.value)}
                disabled={isBusy}
                placeholder={t('projectMountManager.localNamePlaceholder')}
                data-testid="workspace-project-mount-local-name"
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || !canBrowseLocal}
                  data-testid="workspace-project-mount-browse-local"
                  onClick={() => {
                    void browseLocalMount()
                  }}
                >
                  {t('projectMountManager.browseLocalAction')}
                </button>
              </div>
            </div>
          </div>

          <div className="cove-window__field-row">
            <label>{t('projectMountManager.addRemoteLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <CoveSelect
                testId="workspace-project-mount-remote-endpoint"
                value={remoteEndpointId}
                options={remoteEndpoints.map(endpoint => ({
                  value: endpoint.endpointId,
                  label: toEndpointLabel(endpoint),
                }))}
                disabled={isBusy || remoteEndpoints.length === 0}
                onChange={nextValue => setRemoteEndpointId(nextValue)}
              />
              <input
                className="cove-field"
                type="text"
                value={remoteRootPath}
                onChange={event => setRemoteRootPath(event.target.value)}
                disabled={isBusy || remoteEndpoints.length === 0}
                placeholder={t('projectMountManager.remoteRootPlaceholder')}
                data-testid="workspace-project-mount-remote-root"
              />
              <input
                className="cove-field"
                type="text"
                value={remoteMountName}
                onChange={event => setRemoteMountName(event.target.value)}
                disabled={isBusy || remoteEndpoints.length === 0}
                placeholder={t('projectMountManager.remoteNamePlaceholder')}
                data-testid="workspace-project-mount-remote-name"
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  disabled={isBusy || !canCreateRemote}
                  data-testid="workspace-project-mount-add-remote"
                  onClick={() => {
                    void createRemoteMount()
                  }}
                >
                  {t('common.add')}
                </button>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy}
                  data-testid="workspace-project-mount-refresh"
                  onClick={() => {
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
                >
                  {t('common.refresh')}
                </button>
              </div>
            </div>
          </div>
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
  )
}
