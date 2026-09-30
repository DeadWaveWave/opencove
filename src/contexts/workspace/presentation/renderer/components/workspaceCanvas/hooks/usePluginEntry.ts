import { useCallback } from 'react'
import type { ContextMenuState } from '../types'

export function useWorkspaceCanvasPluginEntry({
  contextMenu,
  setContextMenu,
  createPluginNode,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  createPluginNode: (point: { x: number; y: number }, pluginId: string) => void
}): (pluginId: string) => void {
  return useCallback(
    (pluginId: string) => {
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      setContextMenu(null)
      createPluginNode({ x: contextMenu.flowX, y: contextMenu.flowY }, pluginId)
    },
    [contextMenu, createPluginNode, setContextMenu],
  )
}
