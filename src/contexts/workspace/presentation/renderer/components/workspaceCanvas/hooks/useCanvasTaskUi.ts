import { useWorkspaceCanvasTaskSupport } from './useCanvasTaskSupport'
import { useWorkspaceCanvasTaskWindows } from './useCanvasTaskWindows'

export function useWorkspaceCanvasTaskUi({
  agentTaskTagOptions,
  updateCanvasDocument,
  setNodes,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  agentSettings,
  workspaceId,
  workspacePath,
  environmentVariables,
  actionRefs,
  terminalDisplayMetrics,
  standardWindowSizeBucket,
  createTaskNode,
  closeNode,
}: {
  agentTaskTagOptions: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['agentTaskTagOptions']
  updateCanvasDocument: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['updateCanvasDocument']
  setNodes: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['setNodes']
  createNodeForSession: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['createNodeForSession']
  buildAgentNodeTitle: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['buildAgentNodeTitle']
  launchAgentInNode: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['launchAgentInNode']
  agentSettings: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['agentSettings']
  workspaceId: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['workspaceId']
  workspacePath: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['workspacePath']
  environmentVariables?: Record<string, string>
  terminalDisplayMetrics: Parameters<
    typeof useWorkspaceCanvasTaskSupport
  >[0]['terminalDisplayMetrics']
  actionRefs: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['actionRefs'] &
    Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['actionRefs']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasTaskWindows
  >[0]['standardWindowSizeBucket']
  createTaskNode: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['createTaskNode']
  closeNode: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['closeNode']
}): ReturnType<typeof useWorkspaceCanvasTaskSupport> &
  ReturnType<typeof useWorkspaceCanvasTaskWindows> {
  const { taskTagOptions, suggestTaskTitle } = useWorkspaceCanvasTaskSupport({
    agentTaskTagOptions,
    updateCanvasDocument,
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    actionRefs,
    terminalDisplayMetrics,
  })

  const taskWindows = useWorkspaceCanvasTaskWindows({
    workspaceId,
    taskTagOptions,
    setNodes,
    updateCanvasDocument,
    suggestTaskTitle,
    standardWindowSizeBucket,
    createTaskNode,
    closeNode,
    actionRefs,
  })

  return {
    taskTagOptions,
    suggestTaskTitle,
    ...taskWindows,
  }
}
