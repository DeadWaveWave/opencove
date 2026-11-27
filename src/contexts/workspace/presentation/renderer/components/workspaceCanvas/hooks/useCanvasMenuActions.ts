import { useWorkspaceCanvasArrange } from './useArrange'
import { useWorkspaceCanvasNoteToTaskConversion } from './useNoteToTaskConversion'

export function useWorkspaceCanvasMenuActions({
  selectedNodeIds,
  flowNodes,
  onShowMessage,
  reactFlow,
  readAgentSettings,
}: {
  selectedNodeIds: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['selectedNodeIds']
  flowNodes: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['flowNodes']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNoteToTaskConversion>[0]['onShowMessage']
  reactFlow: Parameters<typeof useWorkspaceCanvasArrange>[0]['reactFlow']
  readAgentSettings: Parameters<typeof useWorkspaceCanvasArrange>[0]['readAgentSettings']
}): ReturnType<typeof useWorkspaceCanvasNoteToTaskConversion> &
  ReturnType<typeof useWorkspaceCanvasArrange> {
  const noteToTask = useWorkspaceCanvasNoteToTaskConversion({
    selectedNodeIds,
    flowNodes,
    onShowMessage,
    readAgentSettings,
  })

  const arrange = useWorkspaceCanvasArrange({
    reactFlow,
    readAgentSettings,
    onShowMessage,
  })

  return {
    ...noteToTask,
    ...arrange,
  }
}
