import { useWorkspaceCanvasTaskActions } from './useTaskActions'
import { useWorkspaceCanvasTaskTagOptions } from './useTaskTagOptions'

export function useWorkspaceCanvasTaskSupport({
  agentTaskTagOptions,
  nodesRef,
  spacesRef,
  updateCanvasDocument,
  setNodes,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  agentSettings,
  workspaceId,
  workspacePath,
  environmentVariables,
  onRequestPersistFlush,
  actionRefs,
  terminalDisplayMetrics,
}: {
  agentTaskTagOptions: Parameters<typeof useWorkspaceCanvasTaskTagOptions>[0]
  nodesRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['nodesRef']
  spacesRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['spacesRef']
  updateCanvasDocument: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['updateCanvasDocument']
  setNodes: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['setNodes']
  createNodeForSession: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['createNodeForSession']
  buildAgentNodeTitle: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['buildAgentNodeTitle']
  launchAgentInNode: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['launchAgentInNode']
  agentSettings: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['agentSettings']
  workspaceId: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['workspaceId']
  workspacePath: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['workspacePath']
  environmentVariables?: Record<string, string>
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasTaskActions
  >[0]['onRequestPersistFlush']
  terminalDisplayMetrics: Parameters<
    typeof useWorkspaceCanvasTaskActions
  >[0]['terminalDisplayMetrics']
  actionRefs: {
    runTaskAgentRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['runTaskAgentRef']
    resumeTaskAgentSessionRef: Parameters<
      typeof useWorkspaceCanvasTaskActions
    >[0]['resumeTaskAgentSessionRef']
    removeTaskAgentSessionRecordRef: Parameters<
      typeof useWorkspaceCanvasTaskActions
    >[0]['removeTaskAgentSessionRecordRef']
    updateTaskStatusRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['updateTaskStatusRef']
    quickUpdateTaskTitleRef: Parameters<
      typeof useWorkspaceCanvasTaskActions
    >[0]['quickUpdateTaskTitleRef']
    quickUpdateTaskRequirementRef: Parameters<
      typeof useWorkspaceCanvasTaskActions
    >[0]['quickUpdateTaskRequirementRef']
  }
}): {
  taskTagOptions: string[]
  suggestTaskTitle: ReturnType<typeof useWorkspaceCanvasTaskActions>['suggestTaskTitle']
} {
  const taskTagOptions = useWorkspaceCanvasTaskTagOptions(agentTaskTagOptions)
  const { suggestTaskTitle } = useWorkspaceCanvasTaskActions({
    nodesRef,
    spacesRef,
    updateCanvasDocument,
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    taskTagOptions,
    onRequestPersistFlush,
    terminalDisplayMetrics,
    runTaskAgentRef: actionRefs.runTaskAgentRef,
    resumeTaskAgentSessionRef: actionRefs.resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef: actionRefs.removeTaskAgentSessionRecordRef,
    updateTaskStatusRef: actionRefs.updateTaskStatusRef,
    quickUpdateTaskTitleRef: actionRefs.quickUpdateTaskTitleRef,
    quickUpdateTaskRequirementRef: actionRefs.quickUpdateTaskRequirementRef,
  })

  return {
    taskTagOptions,
    suggestTaskTitle,
  }
}
