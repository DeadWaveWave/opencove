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
  reactFlow,
  spacesRef,
  onSpacesChange,
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
  reactFlow: Parameters<typeof useWorkspaceCanvasArrange>[0]['reactFlow']
  spacesRef: Parameters<typeof useWorkspaceCanvasArrange>[0]['spacesRef']
  onSpacesChange: Parameters<typeof useWorkspaceCanvasArrange>[0]['onSpacesChange']
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
    reactFlow,
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
  })

  return {
    ...noteToTask,
    ...arrange,
  }
}
