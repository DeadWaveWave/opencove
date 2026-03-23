import { useWorkspaceCanvasArrange } from './useArrange'
import { useWorkspaceCanvasNoteToTaskConversion } from './useNoteToTaskConversion'

export function useWorkspaceCanvasMenuActions({
  selectedNodeIds,
  selectedNodeIdsRef,
  flowNodes,
  nodesRef,
  setNodes,
  onRequestPersistFlush,
  onShowMessage,
  setContextMenu,
  spacesRef,
  onSpacesChange,
  onFocusAllInViewport,
}: {
  selectedNodeIds: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['selectedNodeIds']
  selectedNodeIdsRef: Parameters<
    typeof useWorkspaceCanvasNoteToTaskConversion
  >[0]['selectedNodeIdsRef']
  flowNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['flowNodes']
  nodesRef: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['nodesRef']
  setNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['setNodes']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasNoteToTaskConversion
  >[0]['onRequestPersistFlush']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['onShowMessage']
  setContextMenu: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['setContextMenu']
  spacesRef: Parameters<typeof useWorkspaceCanvasArrange>[0]['spacesRef']
  onSpacesChange: Parameters<typeof useWorkspaceCanvasArrange>[0]['onSpacesChange']
  onFocusAllInViewport?: Parameters<typeof useWorkspaceCanvasArrange>[0]['onFocusAllInViewport']
}): ReturnType<typeof useWorkspaceCanvasNoteToTaskConversion> &
  ReturnType<typeof useWorkspaceCanvasArrange> {
  const noteToTask = useWorkspaceCanvasNoteToTaskConversion({
    selectedNodeIds,
    selectedNodeIdsRef,
    flowNodes,
    nodesRef,
    setNodes,
    onRequestPersistFlush,
    onShowMessage,
    setContextMenu,
  })

  const arrange = useWorkspaceCanvasArrange({
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    onFocusAllInViewport,
  })

  return {
    ...noteToTask,
    ...arrange,
  }
}
