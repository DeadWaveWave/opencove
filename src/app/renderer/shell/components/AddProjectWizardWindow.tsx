import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import {
  AnchoredOperationPopover,
  type AnchoredOperationPopoverAnchor,
} from '@app/renderer/components/AnchoredOperationPopover'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { basename } from '../utils/pathHelpers'
import { RemoteDirectoryPickerWindow } from './RemoteDirectoryPickerWindow'
import { RemoteEndpointStatusSlot } from './RemoteEndpointStatusSlot'
import {
  AddProjectWizardDefaultLocationSection,
  type DefaultLocationKind,
} from './addProjectWizard/AddProjectWizardDefaultLocationSection'
import type { RemotePickerState } from './addProjectWizard/helpers'
import { useAddProjectWizardCreateProject } from './addProjectWizard/useAddProjectWizardCreateProject'
import { useAddProjectWizardRemoteEndpoints } from './addProjectWizard/useAddProjectWizardRemoteEndpoints'

export function AddProjectWizardWindow({
  anchor = { x: 24, y: 64 },
  existingWorkspaces,
  remoteWorkersEnabled,
  onClose,
  onRequestOpenEndpoints,
}: {
  anchor?: AnchoredOperationPopoverAnchor
  existingWorkspaces: WorkspaceState[]
  remoteWorkersEnabled: boolean
  onClose: () => void
  onRequestOpenEndpoints: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [defaultLocationKind, setDefaultLocationKind] = useState<DefaultLocationKind>('local')
  const [defaultLocalRootPath, setDefaultLocalRootPath] = useState('')
  const [defaultLocalMountName, setDefaultLocalMountName] = useState('')
  const [defaultRemoteEndpointId, setDefaultRemoteEndpointId] = useState('')
  const [defaultRemoteRootPath, setDefaultRemoteRootPath] = useState('')
  const [defaultRemoteMountName, setDefaultRemoteMountName] = useState('')
  const [unusedExtraRemoteEndpointId, setUnusedExtraRemoteEndpointId] = useState('')
  const [remotePicker, setRemotePicker] = useState<RemotePickerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [homeWorkerMode, setHomeWorkerMode] = useState<'standalone' | 'local' | 'remote' | null>(
    null,
  )
  const [isWorkerModeResolved, setIsWorkerModeResolved] = useState(false)
  const didOpenNativePickerRef = useRef(false)

  const {
    remoteOverviews,
    endpointOptions,
    defaultRemoteOverview,
    endpointError,
    busyByEndpointId,
    runRemoteEndpointAction,
    reconnectRemoteEndpoint,
  } = useAddProjectWizardRemoteEndpoints({
    remoteWorkersEnabled,
    t,
    defaultRemoteEndpointId,
    setDefaultRemoteEndpointId,
    extraRemoteEndpointId: unusedExtraRemoteEndpointId,
    setExtraRemoteEndpointId: setUnusedExtraRemoteEndpointId,
    setError,
  })

  const canBrowseLocal =
    typeof window !== 'undefined' &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    homeWorkerMode !== 'remote'

  useEffect(() => {
    let cancelled = false
    void window.opencoveApi.workerClient
      .getConfig()
      .then(config => {
        if (!cancelled) {
          setHomeWorkerMode(config.mode)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHomeWorkerMode(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsWorkerModeResolved(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const derivedProjectName = useMemo(() => {
    const rootPath = defaultLocationKind === 'local' ? defaultLocalRootPath : defaultRemoteRootPath
    return basename(rootPath).trim()
  }, [defaultLocalRootPath, defaultLocationKind, defaultRemoteRootPath])

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
    extraMounts: [],
  })

  const chooseLocalFolder = useCallback(
    async (createImmediately: boolean) => {
      if (!canBrowseLocal || isBusy) {
        return
      }

      const selected = await window.opencoveApi.workspace.selectDirectory()
      if (!selected) {
        if (!remoteWorkersEnabled) {
          onClose()
        }
        return
      }

      setDefaultLocationKind('local')
      setDefaultLocalRootPath(selected.path)
      setDefaultLocalMountName(selected.name)
      if (createImmediately) {
        await createProject({
          derivedProjectName: selected.name || basename(selected.path),
          defaultLocationKind: 'local',
          defaultLocalRootPath: selected.path,
          defaultLocalMountName: selected.name,
          extraMounts: [],
        })
      }
    },
    [canBrowseLocal, createProject, isBusy, onClose, remoteWorkersEnabled],
  )

  useEffect(() => {
    if (
      remoteWorkersEnabled ||
      !isWorkerModeResolved ||
      !canBrowseLocal ||
      didOpenNativePickerRef.current
    ) {
      return
    }

    didOpenNativePickerRef.current = true
    void chooseLocalFolder(true)
  }, [canBrowseLocal, chooseLocalFolder, isWorkerModeResolved, remoteWorkersEnabled])

  const openRemotePicker = useCallback(() => {
    const endpointId = defaultRemoteEndpointId.trim()
    if (endpointId.length === 0) {
      return
    }

    const endpointLabel =
      endpointOptions.find(option => option.value === endpointId)?.label ?? endpointId
    setRemotePicker({
      target: 'default',
      endpointId,
      endpointLabel,
      initialPath: defaultRemoteRootPath.trim() || null,
    })
  }, [defaultRemoteEndpointId, defaultRemoteRootPath, endpointOptions])

  if (!remoteWorkersEnabled && canBrowseLocal && !error) {
    return null
  }

  const displayError = error ?? endpointError

  return (
    <>
      {remotePicker === null ? (
        <AnchoredOperationPopover
          anchor={anchor}
          ariaLabel={t('addProjectWizard.title')}
          className="workspace-project-create-popover"
          dismissDisabled={isBusy}
          estimatedHeight={defaultLocationKind === 'remote' ? 430 : 280}
          estimatedWidth={360}
          onDismiss={onClose}
          testId="workspace-project-create-window"
        >
          <section className="workspace-project-create">
            <header className="workspace-project-create__header">
              <span className="workspace-project-create__icon" aria-hidden="true">
                <FolderPlus size={16} />
              </span>
              <div>
                <h3>{t('addProjectWizard.title')}</h3>
                <p>{t('addProjectWizard.description')}</p>
              </div>
            </header>

            {displayError ? (
              <p className="cove-window__error" data-testid="workspace-project-create-error">
                {displayError}
              </p>
            ) : null}

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
              onChangeDefaultLocalRootPath={value => {
                setDefaultLocalRootPath(value)
                setDefaultLocalMountName(basename(value))
              }}
              onBrowseDefaultLocalRootPath={() => {
                void chooseLocalFolder(true)
              }}
              onChangeDefaultRemoteEndpointId={setDefaultRemoteEndpointId}
              onChangeDefaultRemoteRootPath={value => {
                setDefaultRemoteRootPath(value)
                setDefaultRemoteMountName(basename(value))
              }}
              onBrowseDefaultRemoteRootPath={openRemotePicker}
              onRequestOpenEndpoints={onRequestOpenEndpoints}
            />

            <div className="workspace-project-create__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                disabled={isBusy}
                onClick={onClose}
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
        </AnchoredOperationPopover>
      ) : null}

      <RemoteDirectoryPickerWindow
        isOpen={remotePicker !== null}
        endpointId={remotePicker?.endpointId ?? ''}
        endpointLabel={remotePicker?.endpointLabel ?? ''}
        initialPath={remotePicker?.initialPath ?? null}
        onCancel={() => {
          setRemotePicker(null)
        }}
        onSelect={path => {
          setRemotePicker(null)
          setDefaultRemoteRootPath(path)
          setDefaultRemoteMountName(basename(path))
        }}
      />
    </>
  )
}
