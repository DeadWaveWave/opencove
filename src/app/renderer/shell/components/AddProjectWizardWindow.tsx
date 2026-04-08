import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '@contexts/workspace/presentation/renderer/types'
import { createDefaultWorkspaceViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import type {
  AllocateProjectPlaceholderResult,
  CreateMountResult,
  WorkerEndpointDto,
} from '@shared/contracts/dto'
import { useAppStore } from '../store/useAppStore'
import { toErrorMessage } from '../utils/format'
import { notifyTopologyChanged } from '../utils/topologyEvents'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { AddProjectWizardEndpointRegisterSection } from './addProjectWizard/AddProjectWizardEndpointRegisterSection'
import { AddProjectWizardMountsSection } from './addProjectWizard/AddProjectWizardMountsSection'
import { basename, isAbsolutePath, type DraftMount } from './addProjectWizard/helpers'

export function AddProjectWizardWindow({
  existingWorkspaces,
  onClose,
}: {
  existingWorkspaces: WorkspaceState[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [endpoints, setEndpoints] = useState<WorkerEndpointDto[]>([])
  const [draftMounts, setDraftMounts] = useState<DraftMount[]>([])
  const [projectName, setProjectName] = useState('')
  const [localRootPath, setLocalRootPath] = useState('')
  const [localMountName, setLocalMountName] = useState('')
  const [remoteEndpointId, setRemoteEndpointId] = useState<string>('')
  const [remoteRootPath, setRemoteRootPath] = useState('')
  const [remoteMountName, setRemoteMountName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [homeWorkerMode, setHomeWorkerMode] = useState<'standalone' | 'local' | 'remote' | null>(
    null,
  )

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

  const endpointOptions = useMemo(
    () =>
      remoteEndpoints.map(endpoint => ({
        value: endpoint.endpointId,
        label: endpoint.displayName,
      })),
    [remoteEndpoints],
  )

  const canBrowseLocal =
    typeof window !== 'undefined' &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    homeWorkerMode !== 'remote'

  const reloadEndpoints = useCallback(async (): Promise<void> => {
    const endpointResult = await window.opencoveApi.controlSurface.invoke<{
      endpoints: WorkerEndpointDto[]
    }>({
      kind: 'query',
      id: 'endpoint.list',
      payload: null,
    })

    setEndpoints(endpointResult.endpoints)
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
  }, [])

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

  useEffect(() => {
    void (async () => {
      setError(null)
      setIsBusy(true)
      try {
        await reloadEndpoints()
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      } finally {
        setIsBusy(false)
      }
    })()
  }, [reloadEndpoints])

  const addMountDraft = useCallback((draft: Omit<DraftMount, 'id'>) => {
    setDraftMounts(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...draft,
      },
    ])
  }, [])

  const removeMountDraft = useCallback((draftId: string) => {
    setDraftMounts(prev => prev.filter(item => item.id !== draftId))
  }, [])

  const addLocalMount = useCallback(async () => {
    const rootPath = localRootPath.trim()
    if (rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('addProjectWizard.localPathMustBeAbsolute'))
      return
    }

    addMountDraft({
      endpointId: 'local',
      rootPath,
      name: localMountName.trim().length > 0 ? localMountName.trim() : null,
    })
    setLocalRootPath('')
    setLocalMountName('')
  }, [addMountDraft, localMountName, localRootPath, t])

  const browseLocalMount = useCallback(async () => {
    if (!canBrowseLocal) {
      return
    }

    const selected = await window.opencoveApi.workspace.selectDirectory()
    if (!selected) {
      return
    }

    setLocalRootPath(selected.path)
    if (localMountName.trim().length === 0) {
      setLocalMountName(selected.name)
    }
  }, [canBrowseLocal, localMountName])

  const addRemoteMount = useCallback(async () => {
    const endpointId = remoteEndpointId.trim()
    const rootPath = remoteRootPath.trim()
    if (endpointId.length === 0 || rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('addProjectWizard.remotePathMustBeAbsolute'))
      return
    }

    addMountDraft({
      endpointId,
      rootPath,
      name: remoteMountName.trim().length > 0 ? remoteMountName.trim() : null,
    })
    setRemoteRootPath('')
    setRemoteMountName('')
  }, [addMountDraft, remoteEndpointId, remoteMountName, remoteRootPath, t])

  const derivedProjectName = useMemo(() => {
    const trimmed = projectName.trim()
    if (trimmed.length > 0) {
      return trimmed
    }

    const first = draftMounts[0]
    if (!first) {
      return ''
    }

    const base = basename(first.rootPath)
    return base.trim()
  }, [draftMounts, projectName])

  const createProject = useCallback(async () => {
    if (isBusy) {
      return
    }

    setError(null)

    const name = derivedProjectName.trim()
    if (name.length === 0) {
      setError(t('addProjectWizard.nameRequired'))
      return
    }

    if (draftMounts.length === 0) {
      setError(t('addProjectWizard.mountRequired'))
      return
    }

    if (existingWorkspaces.some(workspace => workspace.name.trim() === name)) {
      // allow duplicates, but warn via subtle error messaging
    }

    const projectId = crypto.randomUUID()

    setIsBusy(true)
    const createdMountIds: string[] = []
    try {
      const firstLocalMount = draftMounts.find(mount => mount.endpointId === 'local') ?? null
      const workspacePath = firstLocalMount
        ? firstLocalMount.rootPath
        : (
            await window.opencoveApi.controlSurface.invoke<AllocateProjectPlaceholderResult>({
              kind: 'command',
              id: 'workspace.allocateProjectPlaceholder',
              payload: { projectId },
            })
          ).path

      const mountCreationResults = await Promise.allSettled(
        draftMounts.map(mount =>
          window.opencoveApi.controlSurface.invoke<CreateMountResult>({
            kind: 'command',
            id: 'mount.create',
            payload: {
              projectId,
              endpointId: mount.endpointId,
              rootPath: mount.rootPath,
              name: mount.name,
            },
          }),
        ),
      )

      const mountCreationError = mountCreationResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )

      for (const result of mountCreationResults) {
        if (result.status === 'fulfilled') {
          createdMountIds.push(result.value.mount.mountId)
        }
      }

      if (mountCreationError) {
        throw mountCreationError.reason
      }

      const nextWorkspace: WorkspaceState = {
        id: projectId,
        name,
        path: workspacePath,
        nodes: [],
        worktreesRoot: '',
        viewport: createDefaultWorkspaceViewport(),
        isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
      }

      const store = useAppStore.getState()
      store.setWorkspaces(prev => [...prev, nextWorkspace])
      store.setActiveWorkspaceId(nextWorkspace.id)
      store.setFocusRequest(null)

      notifyTopologyChanged()
      onClose()
    } catch (caughtError) {
      await Promise.all(
        createdMountIds.map(mountId =>
          window.opencoveApi.controlSurface
            .invoke({
              kind: 'command',
              id: 'mount.remove',
              payload: { mountId },
            })
            .catch(() => undefined),
        ),
      )

      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }, [derivedProjectName, draftMounts, existingWorkspaces, isBusy, onClose, t])

  const canAddRemoteMount = remoteEndpointId.trim().length > 0 && remoteRootPath.trim().length > 0

  return (
    <div
      className="cove-window-backdrop"
      data-testid="workspace-project-create-backdrop"
      onClick={() => {
        if (isBusy) {
          return
        }

        onClose()
      }}
    >
      <section
        className="cove-window"
        data-testid="workspace-project-create-window"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{t('addProjectWizard.title')}</h3>
        <p>{t('addProjectWizard.description')}</p>

        <div className="cove-window__fields">
          {error ? (
            <p
              className="workspace-task-creator__error"
              data-testid="workspace-project-create-error"
            >
              {error}
            </p>
          ) : null}

          <div className="cove-window__field-row">
            <label htmlFor="workspace-project-create-name">{t('addProjectWizard.nameLabel')}</label>
            <input
              id="workspace-project-create-name"
              className="cove-field"
              type="text"
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
              disabled={isBusy}
              placeholder={t('addProjectWizard.namePlaceholder')}
              data-testid="workspace-project-create-name"
            />
          </div>

          <AddProjectWizardMountsSection
            t={t}
            draftMounts={draftMounts}
            endpointLabelById={endpointLabelById}
            isBusy={isBusy}
            onRemoveMountDraft={removeMountDraft}
          />

          <div className="cove-window__field-row">
            <label>{t('addProjectWizard.addLocalLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <input
                className="cove-field"
                type="text"
                value={localRootPath}
                onChange={event => setLocalRootPath(event.target.value)}
                disabled={isBusy}
                placeholder={t('addProjectWizard.localPathPlaceholder')}
                data-testid="workspace-project-create-local-root"
              />
              <input
                className="cove-field"
                type="text"
                value={localMountName}
                onChange={event => setLocalMountName(event.target.value)}
                disabled={isBusy}
                placeholder={t('addProjectWizard.localNamePlaceholder')}
                data-testid="workspace-project-create-local-name"
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  disabled={isBusy || localRootPath.trim().length === 0}
                  onClick={() => void addLocalMount()}
                  data-testid="workspace-project-create-local-add"
                >
                  {t('common.add')}
                </button>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || !canBrowseLocal}
                  onClick={() => {
                    void browseLocalMount()
                  }}
                  data-testid="workspace-project-create-local-browse"
                >
                  {t('addProjectWizard.browse')}
                </button>
              </div>
            </div>
          </div>

          <div className="cove-window__field-row">
            <label>{t('addProjectWizard.addRemoteLabel')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <CoveSelect
                value={remoteEndpointId}
                options={endpointOptions}
                disabled={isBusy || endpointOptions.length === 0}
                onChange={nextValue => setRemoteEndpointId(nextValue)}
              />
              <input
                className="cove-field"
                type="text"
                value={remoteRootPath}
                onChange={event => setRemoteRootPath(event.target.value)}
                disabled={isBusy || endpointOptions.length === 0}
                placeholder={t('addProjectWizard.remotePathPlaceholder')}
                data-testid="workspace-project-create-remote-root"
              />
              <input
                className="cove-field"
                type="text"
                value={remoteMountName}
                onChange={event => setRemoteMountName(event.target.value)}
                disabled={isBusy || endpointOptions.length === 0}
                placeholder={t('addProjectWizard.remoteNamePlaceholder')}
                data-testid="workspace-project-create-remote-name"
              />
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                disabled={isBusy || !canAddRemoteMount}
                onClick={() => void addRemoteMount()}
                data-testid="workspace-project-create-remote-add"
              >
                {t('common.add')}
              </button>
            </div>
          </div>

          <AddProjectWizardEndpointRegisterSection
            t={t}
            isBusy={isBusy}
            setIsBusy={setIsBusy}
            setError={setError}
            reloadEndpoints={reloadEndpoints}
            onEndpointRegistered={endpointId => setRemoteEndpointId(endpointId)}
          />
        </div>

        <div className="cove-window__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            disabled={isBusy}
            onClick={() => {
              onClose()
            }}
            data-testid="workspace-project-create-cancel"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            disabled={isBusy}
            onClick={() => {
              void createProject()
            }}
            data-testid="workspace-project-create-confirm"
          >
            {isBusy ? t('common.loading') : t('common.create')}
          </button>
        </div>
      </section>
    </div>
  )
}
