import { cleanupNodeRuntimeArtifacts } from '@contexts/workspace/presentation/renderer/utils/nodeRuntimeCleanup'
import { useAppStore } from '../store/useAppStore'

export async function removeWorkspace(workspaceId: string): Promise<void> {
  const store = useAppStore.getState()
  store.setIsRemovingProject(true)

  const targetWorkspace = store.workspaces.find(workspace => workspace.id === workspaceId) ?? null
  if (!targetWorkspace) {
    store.setProjectDeleteConfirmation(null)
    store.setIsRemovingProject(false)
    return
  }

  try {
    targetWorkspace.nodes.forEach(node => {
      cleanupNodeRuntimeArtifacts(node.id, node.data.sessionId)
    })

    await Promise.allSettled(
      targetWorkspace.nodes
        .map(node => node.data.sessionId)
        .filter(sessionId => sessionId.length > 0)
        .map(sessionId => window.opencoveApi.pty.kill({ sessionId })),
    )

    const nextWorkspaces = store.workspaces.filter(workspace => workspace.id !== workspaceId)
    store.setWorkspaces(nextWorkspaces)
    store.setActiveWorkspaceId(currentActiveId =>
      currentActiveId === workspaceId ? (nextWorkspaces[0]?.id ?? null) : currentActiveId,
    )
    store.setFocusRequest(null)
    store.setProjectDeleteConfirmation(null)
  } finally {
    store.setIsRemovingProject(false)
  }
}
