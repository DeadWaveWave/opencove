import { useCallback } from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ListMountsResult } from '@shared/contracts/dto'
import { useAppStore } from '../store/useAppStore'
import { toErrorMessage } from '../utils/format'
import { isAbsolutePath } from '../utils/pathHelpers'
import { removeWorkspace } from '../utils/removeWorkspace'

function resolveWorkspaceOpenInFileManagerPathFromFallback(
  workspace: WorkspaceState,
): string | null {
  const fallbackPath = workspace.path.trim()
  if (fallbackPath.length === 0 || !isAbsolutePath(fallbackPath)) {
    return null
  }

  return fallbackPath
}

async function resolveWorkspaceOpenInFileManagerPath(
  workspace: WorkspaceState,
): Promise<string | null> {
  const controlSurfaceInvoke = window.opencoveApi?.controlSurface?.invoke
  if (typeof controlSurfaceInvoke !== 'function') {
    return resolveWorkspaceOpenInFileManagerPathFromFallback(workspace)
  }

  const mountResult = await controlSurfaceInvoke<ListMountsResult>({
    kind: 'query',
    id: 'mount.list',
    payload: { projectId: workspace.id },
  })

  const localMount =
    mountResult.mounts.find(
      mount => mount.endpointId === 'local' && mount.rootPath.trim().length > 0,
    ) ?? null

  if (localMount) {
    return localMount.rootPath
  }

  if (mountResult.mounts.length > 0) {
    return null
  }

  return resolveWorkspaceOpenInFileManagerPathFromFallback(workspace)
}

export function useAppShellWorkspaceActions({
  requestPersistFlush,
  t,
  showMessage,
}: {
  requestPersistFlush: () => void
  t: TranslateFn
  showMessage: (message: string, tone?: 'info' | 'warning' | 'error') => void
}) {
  const handleRemoveWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    await removeWorkspace(workspaceId)
  }, [])

  const handleSelectWorkspace = useCallback((workspaceId: string): void => {
    const store = useAppStore.getState()
    store.setActiveWorkspaceId(workspaceId)
    store.setFocusRequest(null)
  }, [])

  const handleSelectAgentNode = useCallback((workspaceId: string, nodeId: string): void => {
    const store = useAppStore.getState()
    store.setActiveWorkspaceId(workspaceId)
    store.setFocusRequest(prev => ({
      workspaceId,
      nodeId,
      sequence: (prev?.sequence ?? 0) + 1,
    }))
  }, [])

  const handleRequestRemoveProject = useCallback((workspaceId: string): void => {
    const store = useAppStore.getState()
    const targetWorkspace = store.workspaces.find(workspace => workspace.id === workspaceId)
    if (!targetWorkspace) {
      store.setProjectContextMenu(null)
      return
    }

    store.setProjectDeleteConfirmation({
      workspaceId: targetWorkspace.id,
      workspaceName: targetWorkspace.name,
    })
    store.setProjectContextMenu(null)
  }, [])

  const handleRequestManageProjectMounts = useCallback((workspaceId: string): void => {
    const store = useAppStore.getState()
    const targetWorkspace = store.workspaces.find(workspace => workspace.id === workspaceId)
    if (!targetWorkspace) {
      store.setProjectContextMenu(null)
      return
    }

    store.setProjectMountManager({ workspaceId: targetWorkspace.id })
    store.setProjectContextMenu(null)
  }, [])

  const handleRequestOpenProjectInFileManager = useCallback(
    (workspaceId: string): void => {
      const store = useAppStore.getState()
      const targetWorkspace = store.workspaces.find(workspace => workspace.id === workspaceId)
      store.setProjectContextMenu(null)

      if (!targetWorkspace) {
        return
      }

      const openPath = window.opencoveApi?.workspace?.openPath
      if (typeof openPath !== 'function') {
        return
      }

      void (async () => {
        try {
          const pathToOpen = await resolveWorkspaceOpenInFileManagerPath(targetWorkspace)
          if (!pathToOpen) {
            showMessage(t('messages.projectNoLocalLocationToOpen'), 'warning')
            return
          }

          await openPath({ path: pathToOpen, openerId: 'finder' })
        } catch (error) {
          showMessage(
            t('messages.projectOpenInFileManagerFailed', { message: toErrorMessage(error) }),
            'error',
          )
        }
      })()
    },
    [showMessage, t],
  )

  const handleReorderWorkspaces = useCallback(
    (activeId: string, overId: string): void => {
      const store = useAppStore.getState()
      store.reorderWorkspaces(activeId, overId)
      requestPersistFlush()
    },
    [requestPersistFlush],
  )

  return {
    handleRemoveWorkspace,
    handleSelectWorkspace,
    handleSelectAgentNode,
    handleRequestRemoveProject,
    handleRequestManageProjectMounts,
    handleRequestOpenProjectInFileManager,
    handleReorderWorkspaces,
  }
}
