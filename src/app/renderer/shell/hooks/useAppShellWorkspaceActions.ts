import { useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { removeWorkspace } from '../utils/removeWorkspace'

export function useAppShellWorkspaceActions({
  requestPersistFlush,
}: {
  requestPersistFlush: () => void
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
    handleReorderWorkspaces,
  }
}
