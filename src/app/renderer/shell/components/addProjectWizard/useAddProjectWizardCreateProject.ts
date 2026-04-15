import { useCallback } from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '@contexts/workspace/presentation/renderer/types'
import { createDefaultWorkspaceViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import type { AllocateProjectPlaceholderResult, CreateMountResult } from '@shared/contracts/dto'
import { useAppStore } from '../../store/useAppStore'
import { toErrorMessage } from '../../utils/format'
import { notifyTopologyChanged } from '../../utils/topologyEvents'
import { basename, isAbsolutePath } from '../../utils/pathHelpers'
import type { DefaultLocationKind } from './AddProjectWizardDefaultLocationSection'
import type { DraftMount } from './helpers'

type PlannedMount = {
  endpointId: string
  rootPath: string
  name: string | null
}

function resolveMountName(rootPath: string, nameInput: string): string | null {
  const normalizedName = nameInput.trim()
  const fallbackName = basename(rootPath).trim()
  return normalizedName.length > 0 ? normalizedName : fallbackName.length > 0 ? fallbackName : null
}

export function useAddProjectWizardCreateProject(options: {
  t: TranslateFn
  existingWorkspaces: WorkspaceState[]
  onClose: () => void
  isBusy: boolean
  setIsBusy: (busy: boolean) => void
  setError: (message: string | null) => void
  derivedProjectName: string
  defaultLocationKind: DefaultLocationKind
  defaultLocalRootPath: string
  defaultLocalMountName: string
  defaultRemoteEndpointId: string
  defaultRemoteRootPath: string
  defaultRemoteMountName: string
  extraMounts: DraftMount[]
}): () => Promise<void> {
  return useCallback(async () => {
    if (options.isBusy) {
      return
    }

    options.setError(null)

    const name = options.derivedProjectName.trim()
    if (name.length === 0) {
      options.setError(options.t('addProjectWizard.nameRequired'))
      return
    }

    const defaultMount: PlannedMount | null =
      options.defaultLocationKind === 'local'
        ? (() => {
            const rootPath = options.defaultLocalRootPath.trim()
            if (rootPath.length === 0) {
              options.setError(options.t('addProjectWizard.defaultMountRequired'))
              return null
            }

            if (!isAbsolutePath(rootPath)) {
              options.setError(options.t('addProjectWizard.localPathMustBeAbsolute'))
              return null
            }

            return {
              endpointId: 'local',
              rootPath,
              name: resolveMountName(rootPath, options.defaultLocalMountName),
            }
          })()
        : (() => {
            const endpointId = options.defaultRemoteEndpointId.trim()
            const rootPath = options.defaultRemoteRootPath.trim()
            if (endpointId.length === 0 || rootPath.length === 0) {
              options.setError(options.t('addProjectWizard.defaultMountRequired'))
              return null
            }

            if (!isAbsolutePath(rootPath)) {
              options.setError(options.t('addProjectWizard.remotePathMustBeAbsolute'))
              return null
            }

            return {
              endpointId,
              rootPath,
              name: resolveMountName(rootPath, options.defaultRemoteMountName),
            }
          })()

    if (!defaultMount) {
      return
    }

    if (options.existingWorkspaces.some(workspace => workspace.name.trim() === name)) {
      // allow duplicates, but warn via subtle error messaging
    }

    const mountsToCreate: PlannedMount[] = [
      defaultMount,
      ...options.extraMounts.map(mount => ({
        endpointId: mount.endpointId,
        rootPath: mount.rootPath,
        name: mount.name,
      })),
    ]

    const projectId = crypto.randomUUID()

    options.setIsBusy(true)
    const createdMountIds: string[] = []
    try {
      const firstLocalMount = mountsToCreate.find(mount => mount.endpointId === 'local') ?? null
      const workspacePath = firstLocalMount
        ? firstLocalMount.rootPath
        : (
            await window.opencoveApi.controlSurface.invoke<AllocateProjectPlaceholderResult>({
              kind: 'command',
              id: 'workspace.allocateProjectPlaceholder',
              payload: { projectId },
            })
          ).path

      await mountsToCreate.reduce<Promise<void>>((acc, mount) => {
        return acc.then(async () => {
          const created = await window.opencoveApi.controlSurface.invoke<CreateMountResult>({
            kind: 'command',
            id: 'mount.create',
            payload: {
              projectId,
              endpointId: mount.endpointId,
              rootPath: mount.rootPath,
              name: mount.name,
            },
          })
          createdMountIds.push(created.mount.mountId)
        })
      }, Promise.resolve())

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
      options.onClose()
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

      options.setError(toErrorMessage(caughtError))
    } finally {
      options.setIsBusy(false)
    }
  }, [options])
}
