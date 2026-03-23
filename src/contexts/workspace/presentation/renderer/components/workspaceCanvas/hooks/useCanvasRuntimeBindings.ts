import { useWorkspaceCanvasAgentLastMessageCopy } from './useAgentLastMessageToNote'
import { useWorkspaceCanvasSyncActionRefs, type WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasPtyTaskCompletion } from './usePtyTaskCompletion'

export function useWorkspaceCanvasRuntimeBindings({
  setNodes,
  onRequestPersistFlush,
  actionRefs,
  clearNodeSelection,
  closeNode,
  resizeNode,
  updateNoteText,
  updateNodeScrollback,
  updateTerminalTitle,
  renameTerminalTitle,
  focusNodeOnClick,
  focusNodeTargetZoom,
  nodesRef,
  reactFlow,
  onShowMessage,
}: {
  setNodes: Parameters<typeof useWorkspaceCanvasPtyTaskCompletion>[0]['setNodes']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasPtyTaskCompletion
  >[0]['onRequestPersistFlush']
  actionRefs: WorkspaceCanvasActionRefs
  clearNodeSelection: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['clearNodeSelection']
  closeNode: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['closeNode']
  resizeNode: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['resizeNode']
  updateNoteText: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['updateNoteText']
  updateNodeScrollback: Parameters<
    typeof useWorkspaceCanvasSyncActionRefs
  >[0]['updateNodeScrollback']
  updateTerminalTitle: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['updateTerminalTitle']
  renameTerminalTitle: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['renameTerminalTitle']
  focusNodeOnClick: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['focusNodeOnClick']
  focusNodeTargetZoom: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['focusNodeTargetZoom']
  nodesRef: Parameters<typeof useWorkspaceCanvasAgentLastMessageCopy>[0]['nodesRef']
  reactFlow: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['reactFlow']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasAgentLastMessageCopy>[0]['onShowMessage']
}): void {
  useWorkspaceCanvasPtyTaskCompletion({ setNodes, onRequestPersistFlush })

  const copyAgentLastMessage = useWorkspaceCanvasAgentLastMessageCopy({
    nodesRef,
    onShowMessage,
  })

  useWorkspaceCanvasSyncActionRefs({
    actionRefs,
    clearNodeSelection,
    closeNode,
    resizeNode,
    copyAgentLastMessage,
    updateNoteText,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    focusNodeOnClick,
    focusNodeTargetZoom,
    nodesRef,
    reactFlow,
  })
}
