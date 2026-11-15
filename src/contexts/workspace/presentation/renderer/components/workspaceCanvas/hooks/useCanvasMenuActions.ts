import { useWorkspaceCanvasArrange } from './useArrange'
import { useWorkspaceCanvasNoteToTaskConversion } from './useNoteToTaskConversion'

export function useWorkspaceCanvasMenuActions({
  selectedNodeIds,
  flowNodes,
  nodesRef,
  setNodes,
  onRequestPersistFlush,
  onShowMessage,
  reactFlow,
  spacesRef,
  onSpacesChange,
  standardWindowSizeBucket,
  focusNodeTargetZoom,
}: {
  selectedNodeIds: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['selectedNodeIds']
  flowNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['flowNodes']
  nodesRef: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['nodesRef']
  setNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['setNodes']
  onRequestPersistFlush?: Parameters<
    typeof useWorkspaceCanvasNoteToTaskConversion
  >[0]['onRequestPersistFlush']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['onShowMessage']
  reactFlow: Parameters<typeof useWorkspaceCanvasArrange>[0]['reactFlow']
  spacesRef: Parameters<typeof useWorkspaceCanvasArrange>[0]['spacesRef']
  onSpacesChange: Parameters<typeof useWorkspaceCanvasArrange>[0]['onSpacesChange']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasArrange
  >[0]['standardWindowSizeBucket']
  focusNodeTargetZoom: Parameters<typeof useWorkspaceCanvasArrange>[0]['focusNodeTargetZoom']
}): ReturnType<typeof useWorkspaceCanvasNoteToTaskConversion> &
  ReturnType<typeof useWorkspaceCanvasArrange> {
  const noteToTask = useWorkspaceCanvasNoteToTaskConversion({
    selectedNodeIds,
    flowNodes,
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket,
  })

  const arrange = useWorkspaceCanvasArrange({
    reactFlow,
    focusNodeTargetZoom,
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket,
  })

  return {
    ...noteToTask,
    ...arrange,
  }
}
