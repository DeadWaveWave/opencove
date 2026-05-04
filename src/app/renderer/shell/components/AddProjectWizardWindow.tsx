import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { basename, isAbsolutePath } from '../utils/pathHelpers'
import { RemoteDirectoryPickerWindow } from './RemoteDirectoryPickerWindow'
import { RemoteEndpointStatusSlot } from './RemoteEndpointStatusSlot'
import { AddProjectWizardAdvancedSection } from './addProjectWizard/AddProjectWizardAdvancedSection'
import {
  AddProjectWizardDefaultLocationSection,
  type DefaultLocationKind,
} from './addProjectWizard/AddProjectWizardDefaultLocationSection'
import type { PlannedMount } from './addProjectWizard/AddProjectWizardPlannedMountsSection'
import type { DraftMount, RemotePickerState } from './addProjectWizard/helpers'
import { useAddProjectWizardCreateProject } from './addProjectWizard/useAddProjectWizardCreateProject'
import { useAddProjectWizardRemoteEndpoints } from './addProjectWizard/useAddProjectWizardRemoteEndpoints'
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
  const {
    remoteOverviews,
    endpointLabelById,
    endpointOptions,
    defaultRemoteOverview,
    extraRemoteOverview,
    endpointError,
    busyByEndpointId,
    reloadRemoteOverviews,
    runRemoteEndpointAction,
    reconnectRemoteEndpoint,
  } = useAddProjectWizardRemoteEndpoints({
    remoteWorkersEnabled,
    t,
    defaultRemoteEndpointId,
    setDefaultRemoteEndpointId,
    extraRemoteEndpointId,
    setExtraRemoteEndpointId,
    setError,
  })

  const canBrowseLocal =
    typeof window !== 'undefined' &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    homeWorkerMode !== 'remote'

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

  const displayError = error ?? endpointError

  const defaultMountPreview = useMemo<PlannedMount | null>(() => {
    if (!remoteWorkersEnabled) {
      const rootPath = defaultLocalRootPath.trim()
      if (rootPath.length === 0) {
        return null
      }

      return {
        endpointId: 'local',
        rootPath,
        name: defaultLocalMountName.trim() || basename(rootPath).trim() || null,
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
        name: defaultLocalMountName.trim() || basename(rootPath).trim() || null,
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
      name: defaultRemoteMountName.trim() || basename(rootPath).trim() || null,
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
    (target: 'default' | 'extra') => {
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
      name: extraLocalMountName.trim() || basename(rootPath).trim() || null,
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
      name: extraRemoteMountName.trim() || basename(rootPath).trim() || null,
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
          className="cove-window cove-window--xwide"
          data-testid="workspace-project-create-window"
          onClick={event => event.stopPropagation()}
        >
          <h3>{t('addProjectWizard.title')}</h3>
          <p className="cove-window__intro">
            {remoteWorkersEnabled
              ? t('addProjectWizard.description')
              : t('addProjectWizard.descriptionLocalOnly')}
          </p>

          <div className="cove-window__fields">
            {displayError ? (
              <p className="cove-window__error" data-testid="workspace-project-create-error">
                {displayError}
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
              remoteEndpointsCount={remoteOverviews.length}
              endpointOptions={endpointOptions}
              defaultLocationKind={defaultLocationKind}
              defaultLocalRootPath={defaultLocalRootPath}
              defaultRemoteEndpointId={defaultRemoteEndpointId}
              defaultRemoteRootPath={defaultRemoteRootPath}
              remoteStatusSlot={
                <RemoteEndpointStatusSlot
                  t={t}
                  overview={defaultRemoteOverview}
                  busyByEndpointId={busyByEndpointId}
                  compact
                  showIdentity={false}
                  testIdPrefix="workspace-project-create-default-remote-status"
                  onRunAction={endpointId => {
                    void runRemoteEndpointAction(endpointId)
                  }}
                  onReconnect={endpointId => {
                    void reconnectRemoteEndpoint(endpointId)
                  }}
                />
              }
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
                remoteEndpointsCount={remoteOverviews.length}
                endpointOptions={endpointOptions}
                extraLocalRootPath={extraLocalRootPath}
                extraLocalMountName={extraLocalMountName}
                extraRemoteEndpointId={extraRemoteEndpointId}
                extraRemoteRootPath={extraRemoteRootPath}
                extraRemoteMountName={extraRemoteMountName}
                canCreateExtraRemote={canCreateExtraRemote}
                extraRemoteStatusSlot={
                  <RemoteEndpointStatusSlot
                    t={t}
                    overview={extraRemoteOverview}
                    busyByEndpointId={busyByEndpointId}
                    compact
                    showIdentity={false}
                    testIdPrefix="workspace-project-create-extra-remote-status"
                    onRunAction={endpointId => {
                      void runRemoteEndpointAction(endpointId)
                    }}
                    onReconnect={endpointId => {
                      void reconnectRemoteEndpoint(endpointId)
                    }}
                  />
                }
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
                onReloadEndpoints={() => {
                  void reloadRemoteOverviews()
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