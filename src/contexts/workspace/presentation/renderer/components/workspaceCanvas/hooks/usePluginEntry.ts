import { useCallback } from 'react'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'

export function useWorkspaceCanvasPluginEntry({
  createPluginNode,
}: {
  createPluginNode: (point: { x: number; y: number }, pluginId: string) => void
}): (pluginId: string) => void {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()

  return useCallback(
    (pluginId: string) => {
      const contextMenu = readUi().contextMenu
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      ui.closeContextMenu()
      createPluginNode({ x: contextMenu.flowX, y: contextMenu.flowY }, pluginId)
    },
    [createPluginNode, readUi, ui],
  )
}
