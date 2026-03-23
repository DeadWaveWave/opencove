import { useWorkspaceCanvasTaskActions } from './useTaskActions'
import { useWorkspaceCanvasTaskTagOptions } from './useTaskTagOptions'

export function useWorkspaceCanvasTaskSupport({
  agentTaskTagOptions,
  nodesRef,
  spacesRef,
  onSpacesChange,
  setNodes,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  agentSettings,
  workspacePath,
  onRequestPersistFlush,
  actionRefs,
}: {
  agentTaskTagOptions: Parameters<typeof useWorkspaceCanvasTaskTagOptions>[0]
  nodesRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['nodesRef']
  spacesRef: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['spacesRef']
  onSpacesChange: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['onSpacesChange']
  setNodes: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['setNodes']
  createNodeForSession: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['createNodeForSession']
  buildAgentNodeTitle: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['buildAgentNodeTitle']
  launchAgentInNode: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['launchAgentInNode']
  agentSettings: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['agentSettings']
  workspacePath: Parameters<typeof useWorkspaceCanvasTaskActions>[0]['workspacePath']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasTaskActions
  >[0]['onRequestPersistFlush']
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
    onSpacesChange,
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspacePath,
    taskTagOptions,
    onRequestPersistFlush,
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
