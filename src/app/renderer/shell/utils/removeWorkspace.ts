import { cleanupNodeRuntimeArtifacts } from '@contexts/workspace/presentation/renderer/utils/nodeRuntimeCleanup'
import { allowNextEmptyWorkspacePersistedStateWrite } from '@contexts/workspace/presentation/renderer/utils/persistence'
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
    if (nextWorkspaces.length === 0) {
      allowNextEmptyWorkspacePersistedStateWrite()
    }
    store.setWorkspaces(nextWorkspaces)
    store.setActiveWorkspaceId(currentActiveId =>
      currentActiveId === workspaceId ? (nextWorkspaces[0]?.id ?? null) : currentActiveId,
    )
    store.setAgentSettings(prev => {
      const hasTaskTemplates = Boolean(prev.taskPromptTemplatesByWorkspaceId[workspaceId])
      const hasProjectRoles = Boolean(prev.projectRolesByWorkspaceId[workspaceId])
      if (!hasTaskTemplates && !hasProjectRoles) {
        return prev
      }

      const { [workspaceId]: _removedTaskTemplates, ...restTaskTemplates } =
        prev.taskPromptTemplatesByWorkspaceId
      const { [workspaceId]: _removedProjectRoles, ...restProjectRoles } =
        prev.projectRolesByWorkspaceId
      return {
        ...prev,
        taskPromptTemplatesByWorkspaceId: restTaskTemplates,
        projectRolesByWorkspaceId: restProjectRoles,
      }
    })
    store.setFocusRequest(null)
    store.setProjectDeleteConfirmation(null)
  } finally {
    store.setIsRemovingProject(false)
  }
}
