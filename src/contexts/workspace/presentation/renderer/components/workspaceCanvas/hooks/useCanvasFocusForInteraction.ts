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
 * would renew the command on every tick), the window from the document, and React Flow through
 * `setViewport` and `setCenter`, which read React Flow's store when called. It depends on those two
 * functions and not on the instance: in `@xyflow/react` 12.10.1 `useReactFlow()` renews its object
 * when the viewport initializes, but the two come from `useViewportHelper`, memoised with `[]`, so
 * the command keeps its identity there.
 */
export function useCanvasFocusForInteraction({
  reactFlow,
  readAgentSettings,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
}): (nodeId: string) => void {
  const readDocument = useReadCanvasDocument()

  const { setViewport, setCenter } = reactFlow

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

      focusNodeInViewport({ setViewport, setCenter }, targetNode, {
        duration: 120,
        zoom: focusNodeTargetZoom,
      })
    },
    [readAgentSettings, readDocument, setCenter, setViewport],
  )
}
