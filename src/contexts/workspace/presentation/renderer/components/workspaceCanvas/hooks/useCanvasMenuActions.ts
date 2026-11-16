import { useWorkspaceCanvasArrange } from './useArrange'
import { useWorkspaceCanvasNoteToTaskConversion } from './useNoteToTaskConversion'

export function useWorkspaceCanvasMenuActions({
  selectedNodeIds,
  flowNodes,
  updateCanvasDocument,
  onShowMessage,
  reactFlow,
  standardWindowSizeBucket,
  focusNodeTargetZoom,
}: {
  selectedNodeIds: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['selectedNodeIds']
  flowNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['flowNodes']
  updateCanvasDocument: Parameters<typeof useWorkspaceCanvasArrange>[0]['updateCanvasDocument']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['onShowMessage']
  reactFlow: Parameters<typeof useWorkspaceCanvasArrange>[0]['reactFlow']
  standardWindowSizeBucket: Parameters<
    typeof useWorkspaceCanvasArrange
  >[0]['standardWindowSizeBucket']
  focusNodeTargetZoom: Parameters<typeof useWorkspaceCanvasArrange>[0]['focusNodeTargetZoom']
}): ReturnType<typeof useWorkspaceCanvasNoteToTaskConversion> &
  ReturnType<typeof useWorkspaceCanvasArrange> {
  const noteToTask = useWorkspaceCanvasNoteToTaskConversion({
    selectedNodeIds,
    flowNodes,
    updateCanvasDocument,
    onShowMessage,
    standardWindowSizeBucket,
  })

  const arrange = useWorkspaceCanvasArrange({
    reactFlow,
    focusNodeTargetZoom,
    updateCanvasDocument,
    onShowMessage,
    standardWindowSizeBucket,
  })

  return {
    ...noteToTask,
    ...arrange,
  }
}
