import { useWorkspaceCanvasTaskSupport } from './useCanvasTaskSupport'
import { useWorkspaceCanvasTaskWindows } from './useCanvasTaskWindows'

export function useWorkspaceCanvasTaskUi({
  agentTaskTagOptions,
  nodesRef,
  spacesRef,
  onSpacesChange,
  setNodes,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  agentSettings,
  workspaceId,
  workspacePath,
  onRequestPersistFlush,
  actionRefs,
  contextMenu,
  setContextMenu,
  standardWindowSizeBucket,
  createTaskNode,
  closeNode,
}: {
  agentTaskTagOptions: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['agentTaskTagOptions']
  nodesRef: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['nodesRef']
  spacesRef: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['spacesRef']
  onSpacesChange: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['onSpacesChange']
  setNodes: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['setNodes']
  createNodeForSession: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['createNodeForSession']
  buildAgentNodeTitle: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['buildAgentNodeTitle']
  launchAgentInNode: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['launchAgentInNode']
  agentSettings: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['agentSettings']
  workspaceId: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['workspaceId']
  workspacePath: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['workspacePath']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasTaskSupport
  >[0]['onRequestPersistFlush']
  actionRefs: Parameters<typeof useWorkspaceCanvasTaskSupport>[0]['actionRefs'] &
    Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['actionRefs']
  contextMenu: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['contextMenu']
  setContextMenu: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['setContextMenu']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasTaskWindows
  >[0]['standardWindowSizeBucket']
  createTaskNode: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['createTaskNode']
  closeNode: Parameters<typeof useWorkspaceCanvasTaskWindows>[0]['closeNode']
}): ReturnType<typeof useWorkspaceCanvasTaskSupport> &
  ReturnType<typeof useWorkspaceCanvasTaskWindows> {
  const { taskTagOptions, suggestTaskTitle } = useWorkspaceCanvasTaskSupport({
    agentTaskTagOptions,
    nodesRef,
    spacesRef,
    onSpacesChange,
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspaceId,
    workspacePath,
    onRequestPersistFlush,
    actionRefs,
  })

  const taskWindows = useWorkspaceCanvasTaskWindows({
    taskTagOptions,
    contextMenu,
    setContextMenu,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
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
