import { useCallback } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasProps } from '../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { focusNodeInViewport } from '../helpers'

/**
 * `window.focusForInteraction` (S7 of #647): centres a window in the viewport when "focus on
 * click" is on. It reads what it needs when it runs: the settings from their owner through
 * `readAgentSettings` (the zoom slider writes them on every input event, so a closure over them
 * would renew the command on every tick), the window from the document, and React Flow through its
 * instance, whose methods read React Flow's store.
 */
export function useCanvasFocusForInteraction({
  reactFlow,
  readAgentSettings,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
}): (nodeId: string) => void {
  const readDocument = useReadCanvasDocument()

  return useCallback(
    (nodeId: string) => {
      const { focusNodeOnClick, focusNodeTargetZoom } = readAgentSettings()
      if (!focusNodeOnClick) {
        return
      }

      const targetNode = readDocument().nodes.find(node => node.id === nodeId)
      if (!targetNode) {
        return
      }

      focusNodeInViewport(reactFlow, targetNode, { duration: 120, zoom: focusNodeTargetZoom })
    },
    [reactFlow, readAgentSettings, readDocument],
  )
}
