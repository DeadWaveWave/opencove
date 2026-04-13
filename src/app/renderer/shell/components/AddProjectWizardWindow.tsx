import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { WorkerEndpointDto } from '@shared/contracts/dto'
import { toErrorMessage } from '../utils/format'
import { basename, isAbsolutePath } from '../utils/pathHelpers'
import { RemoteDirectoryPickerWindow } from './RemoteDirectoryPickerWindow'
import { AddProjectWizardAdvancedSection } from './addProjectWizard/AddProjectWizardAdvancedSection'
import {
  AddProjectWizardDefaultLocationSection,
  type DefaultLocationKind,
} from './addProjectWizard/AddProjectWizardDefaultLocationSection'
import type { PlannedMount } from './addProjectWizard/AddProjectWizardPlannedMountsSection'
import type { DraftMount } from './addProjectWizard/helpers'
import { useAddProjectWizardCreateProject } from './addProjectWizard/useAddProjectWizardCreateProject'
type RemotePickerTarget = 'default' | 'extra'
type RemotePickerState = {
  target: RemotePickerTarget
  endpointId: string
  endpointLabel: string
  initialPath: string | null
}
function resolveMountName(rootPath: string, nameInput: string): string | null {
  const normalizedName = nameInput.trim()
  const fallbackName = basename(rootPath).trim()
  return normalizedName.length > 0 ? normalizedName : fallbackName.length > 0 ? fallbackName : null
}

export function AddProjectWizardWindow({
  existingWorkspaces,
  remoteWorkersEnabled,
  onClose,
  onRequestOpenEndpoints,
}: {
  existingWorkspaces: WorkspaceState[]
  remoteWorkersEnabled: boolean
  onClose: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [endpoints, setEndpoints] = useState<WorkerEndpointDto[]>([])
  const [extraMounts, setExtraMounts] = useState<DraftMount[]>([])
  const [projectName, setProjectName] = useState('')
  const [defaultLocationKind, setDefaultLocationKind] = useState<DefaultLocationKind>('local')
  const [defaultLocalRootPath, setDefaultLocalRootPath] = useState('')
  const [defaultLocalMountName, setDefaultLocalMountName] = useState('')
  const [defaultRemoteEndpointId, setDefaultRemoteEndpointId] = useState<string>('')
  const [defaultRemoteRootPath, setDefaultRemoteRootPath] = useState('')
  const [defaultRemoteMountName, setDefaultRemoteMountName] = useState('')
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [extraLocalRootPath, setExtraLocalRootPath] = useState('')
  const [extraLocalMountName, setExtraLocalMountName] = useState('')
  const [extraRemoteEndpointId, setExtraRemoteEndpointId] = useState<string>('')
  const [extraRemoteRootPath, setExtraRemoteRootPath] = useState('')
  const [extraRemoteMountName, setExtraRemoteMountName] = useState('')
  const [remotePicker, setRemotePicker] = useState<RemotePickerState | null>(null)
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
    setDefaultRemoteEndpointId(current => {
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
    setExtraRemoteEndpointId(current => {
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

  const reloadEndpointsWithUi = useCallback(() => {
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
    if (!remoteWorkersEnabled) {
      setEndpoints([])
      return
    }

    reloadEndpointsWithUi()
  }, [reloadEndpointsWithUi, remoteWorkersEnabled])

  useEffect(() => {
    if (!remoteWorkersEnabled) {
      setDefaultLocationKind('local')
    }
  }, [remoteWorkersEnabled])

  const derivedProjectName = useMemo(() => {
    const trimmed = projectName.trim()
    if (trimmed.length > 0) {
      return trimmed
    }

    const candidateRoot =
      defaultLocationKind === 'local' ? defaultLocalRootPath.trim() : defaultRemoteRootPath.trim()
    if (candidateRoot.length > 0) {
      return basename(candidateRoot).trim()
    }

    const fallback = extraMounts[0]?.rootPath
    return fallback ? basename(fallback).trim() : ''
  }, [defaultLocalRootPath, defaultLocationKind, defaultRemoteRootPath, extraMounts, projectName])

  const defaultMountPreview = useMemo<PlannedMount | null>(() => {
    if (!remoteWorkersEnabled) {
      const rootPath = defaultLocalRootPath.trim()
      if (rootPath.length === 0) {
        return null
      }

      return {
        endpointId: 'local',
        rootPath,
        name: resolveMountName(rootPath, defaultLocalMountName),
      }
    }

    if (defaultLocationKind === 'local') {
      const rootPath = defaultLocalRootPath.trim()
      if (rootPath.length === 0) {
        return null
      }

      return {
        endpointId: 'local',
        rootPath,
        name: resolveMountName(rootPath, defaultLocalMountName),
      }
    }

    const endpointId = defaultRemoteEndpointId.trim()
    const rootPath = defaultRemoteRootPath.trim()
    if (endpointId.length === 0 || rootPath.length === 0) {
      return null
    }

    return {
      endpointId,
      rootPath,
      name: resolveMountName(rootPath, defaultRemoteMountName),
    }
  }, [
    defaultLocalMountName,
    defaultLocalRootPath,
    defaultLocationKind,
    defaultRemoteEndpointId,
    defaultRemoteMountName,
    defaultRemoteRootPath,
    remoteWorkersEnabled,
  ])

  const addExtraMountDraft = useCallback((draft: Omit<DraftMount, 'id'>) => {
    setExtraMounts(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...draft,
      },
    ])
  }, [])

  const removeExtraMountDraft = useCallback((draftId: string) => {
    setExtraMounts(prev => prev.filter(item => item.id !== draftId))
  }, [])

  const browseDefaultLocalMount = useCallback(async () => {
    if (!canBrowseLocal) {
      return
    }

    const selected = await window.opencoveApi.workspace.selectDirectory()
    if (!selected) {
      return
    }

    setDefaultLocalRootPath(selected.path)
    if (defaultLocalMountName.trim().length === 0) {
      setDefaultLocalMountName(selected.name)
    }
  }, [canBrowseLocal, defaultLocalMountName])

  const browseExtraLocalMount = useCallback(async () => {
    if (!canBrowseLocal) {
      return
    }

    const selected = await window.opencoveApi.workspace.selectDirectory()
    if (!selected) {
      return
    }

    setExtraLocalRootPath(selected.path)
    if (extraLocalMountName.trim().length === 0) {
      setExtraLocalMountName(selected.name)
    }
  }, [canBrowseLocal, extraLocalMountName])

  const openRemotePicker = useCallback(
    (target: RemotePickerTarget) => {
      const endpointId =
        target === 'default' ? defaultRemoteEndpointId.trim() : extraRemoteEndpointId.trim()
      if (endpointId.length === 0) {
        return
      }

      const endpointLabel = endpointLabelById.get(endpointId) ?? endpointId
      const initialPath =
        target === 'default' ? defaultRemoteRootPath.trim() : extraRemoteRootPath.trim()

      setRemotePicker({
        target,
        endpointId,
        endpointLabel,
        initialPath: initialPath.length > 0 ? initialPath : null,
      })
    },
    [
      defaultRemoteEndpointId,
      defaultRemoteRootPath,
      endpointLabelById,
      extraRemoteEndpointId,
      extraRemoteRootPath,
    ],
  )

  const addExtraLocalMount = useCallback(() => {
    const rootPath = extraLocalRootPath.trim()
    if (rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('addProjectWizard.localPathMustBeAbsolute'))
      return
    }

    addExtraMountDraft({
      endpointId: 'local',
      rootPath,
      name: resolveMountName(rootPath, extraLocalMountName),
    })
    setExtraLocalRootPath('')
    setExtraLocalMountName('')
  }, [addExtraMountDraft, extraLocalMountName, extraLocalRootPath, t])

  const addExtraRemoteMount = useCallback(() => {
    const endpointId = extraRemoteEndpointId.trim()
    const rootPath = extraRemoteRootPath.trim()
    if (endpointId.length === 0 || rootPath.length === 0) {
      return
    }

    if (!isAbsolutePath(rootPath)) {
      setError(t('addProjectWizard.remotePathMustBeAbsolute'))
      return
    }

    addExtraMountDraft({
      endpointId,
      rootPath,
      name: resolveMountName(rootPath, extraRemoteMountName),
    })
    setExtraRemoteRootPath('')
    setExtraRemoteMountName('')
  }, [addExtraMountDraft, extraRemoteEndpointId, extraRemoteMountName, extraRemoteRootPath, t])

  const createProject = useAddProjectWizardCreateProject({
    t,
    existingWorkspaces,
    onClose,
    isBusy,
    setIsBusy,
    setError,
    derivedProjectName,
    defaultLocationKind,
    defaultLocalRootPath,
    defaultLocalMountName,
    defaultRemoteEndpointId,
    defaultRemoteRootPath,
    defaultRemoteMountName,
    extraMounts,
  })

  const canCreateExtraRemote =
    extraRemoteEndpointId.trim().length > 0 && extraRemoteRootPath.trim().length > 0

  return (
    <>
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
          onClick={event => event.stopPropagation()}
        >
          <h3>{t('addProjectWizard.title')}</h3>
          <p>
            {remoteWorkersEnabled
              ? t('addProjectWizard.description')
              : t('addProjectWizard.descriptionLocalOnly')}
          </p>

          <div className="cove-window__fields">
            {error ? (
              <p className="cove-window__error" data-testid="workspace-project-create-error">
                {error}
              </p>
            ) : null}

            <div className="cove-window__field-row">
              <label htmlFor="workspace-project-create-name">
                {t('addProjectWizard.nameLabel')}
              </label>
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

            <AddProjectWizardDefaultLocationSection
              t={t}
              isBusy={isBusy}
              canBrowseLocal={canBrowseLocal}
              showRemote={remoteWorkersEnabled}
              remoteEndpointsCount={remoteEndpoints.length}
              endpointOptions={endpointOptions}
              defaultLocationKind={defaultLocationKind}
              defaultLocalRootPath={defaultLocalRootPath}
              defaultRemoteEndpointId={defaultRemoteEndpointId}
              defaultRemoteRootPath={defaultRemoteRootPath}
              onChangeDefaultLocationKind={setDefaultLocationKind}
              onChangeDefaultLocalRootPath={setDefaultLocalRootPath}
              onBrowseDefaultLocalRootPath={() => void browseDefaultLocalMount()}
              onChangeDefaultRemoteEndpointId={setDefaultRemoteEndpointId}
              onChangeDefaultRemoteRootPath={setDefaultRemoteRootPath}
              onBrowseDefaultRemoteRootPath={() => {
                if (!remoteWorkersEnabled) {
                  return
                }

                openRemotePicker('default')
              }}
              onRequestOpenEndpoints={onRequestOpenEndpoints}
            />

            {remoteWorkersEnabled ? (
              <AddProjectWizardAdvancedSection
                t={t}
                isBusy={isBusy}
                canBrowseLocal={canBrowseLocal}
                showRemote={remoteWorkersEnabled}
                isAdvancedOpen={isAdvancedOpen}
                defaultMountPreview={defaultMountPreview}
                extraMounts={extraMounts}
                endpointLabelById={endpointLabelById}
                remoteEndpointsCount={remoteEndpoints.length}
                endpointOptions={endpointOptions}
                extraLocalRootPath={extraLocalRootPath}
                extraLocalMountName={extraLocalMountName}
                extraRemoteEndpointId={extraRemoteEndpointId}
                extraRemoteRootPath={extraRemoteRootPath}
                extraRemoteMountName={extraRemoteMountName}
                canCreateExtraRemote={canCreateExtraRemote}
                onToggleAdvanced={() => setIsAdvancedOpen(open => !open)}
                onChangeExtraLocalRootPath={setExtraLocalRootPath}
                onChangeExtraLocalMountName={setExtraLocalMountName}
                onBrowseExtraLocalRootPath={() => void browseExtraLocalMount()}
                onAddExtraLocalMount={addExtraLocalMount}
                onChangeExtraRemoteEndpointId={setExtraRemoteEndpointId}
                onChangeExtraRemoteRootPath={setExtraRemoteRootPath}
                onChangeExtraRemoteMountName={setExtraRemoteMountName}
                onBrowseExtraRemoteRootPath={() => {
                  openRemotePicker('extra')
                }}
                onAddExtraRemoteMount={() => {
                  addExtraRemoteMount()
                }}
                onRemoveExtraMount={removeExtraMountDraft}
                onReloadEndpoints={reloadEndpointsWithUi}
                onRequestOpenEndpoints={onRequestOpenEndpoints}
              />
            ) : null}
          </div>

          <div className="cove-window__actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              onClick={() => onClose()}
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

      <RemoteDirectoryPickerWindow
        isOpen={remotePicker !== null}
        endpointId={remotePicker?.endpointId ?? ''}
        endpointLabel={remotePicker?.endpointLabel ?? ''}
        initialPath={remotePicker?.initialPath ?? null}
        onCancel={() => {
          setRemotePicker(null)
        }}
        onSelect={path => {
          const target = remotePicker?.target ?? null
          setRemotePicker(null)

          if (!target) {
            return
          }

          if (target === 'default') {
            setDefaultRemoteRootPath(path)
            if (defaultRemoteMountName.trim().length === 0) {
              setDefaultRemoteMountName(basename(path))
            }
            return
          }

          setExtraRemoteRootPath(path)
          if (extraRemoteMountName.trim().length === 0) {
            setExtraRemoteMountName(basename(path))
          }
        }}
      />
    </>
  )
}
