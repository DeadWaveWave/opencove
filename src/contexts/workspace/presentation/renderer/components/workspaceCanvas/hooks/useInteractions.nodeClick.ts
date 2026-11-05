import { useCallback, type RefObject } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { getPresentedNodeSize } from '../../../utils/canvasInteractionLayout'
import { focusNodeInViewport } from '../helpers'
import { CANVAS_LOD_ATTRIBUTE, FAR_VIEW_FLY_MIN_ZOOM } from '../view/canvasLod'
import { shouldFocusNodeFromClickTarget } from './useInteractions.eventTargets'

/**
 * Clicking a window focuses it when "focus on click" is on. In far view a plain click on a tile
 * always flies to its window and back to near view; modified clicks keep selecting.
 */
export function useWorkspaceCanvasNodeClick({
  canvasRef,
  focusNodeOnClick,
  focusNodeTargetZoom,
  reactFlow,
}: {
  canvasRef: RefObject<HTMLDivElement | null>
  focusNodeOnClick: boolean
  focusNodeTargetZoom: number
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
}): (event: React.MouseEvent, node: Node<TerminalNodeData>) => void {
  return useCallback(
    (event, node) => {
      const displayNode = { ...node, data: { ...node.data, ...getPresentedNodeSize(node.data) } }
      if (canvasRef.current?.getAttribute(CANVAS_LOD_ATTRIBUTE) === 'far') {
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          focusNodeInViewport(reactFlow, displayNode, {
            duration: 220,
            zoom: Math.max(focusNodeTargetZoom, FAR_VIEW_FLY_MIN_ZOOM),
          })
        }
        return
      }
      if (!focusNodeOnClick || !shouldFocusNodeFromClickTarget(event.target)) {
        return
      }
      focusNodeInViewport(reactFlow, displayNode, { duration: 120, zoom: focusNodeTargetZoom })
    },
    [canvasRef, focusNodeOnClick, focusNodeTargetZoom, reactFlow],
  )
}
