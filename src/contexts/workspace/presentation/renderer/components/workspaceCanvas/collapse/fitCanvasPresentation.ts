import type { Node, ReactFlowInstance, FitViewOptions } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CanvasCollapseState } from '../../../utils/canvasCollapse'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'

export function fitCanvasPresentation(
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  collapse: CanvasCollapseState,
  options: FitViewOptions<Node<TerminalNodeData>> = {},
): void {
  if (!spaces.some(space => collapse.collapsedSpaceIds[space.id])) {
    void reactFlow.fitView(options)
    return
  }
  const presented = projectCanvasInteractionLayout(nodes, spaces, collapse)
  const rects = [
    ...presented.nodes
      .filter(node => !node.hidden)
      .map(node => ({ ...node.position, width: node.data.width, height: node.data.height })),
    ...presented.spaces
      .filter(space => collapse.collapsedSpaceIds[space.id] && space.rect)
      .map(space => space.rect!),
  ]
  if (!rects.length) {
    return
  }
  const x = Math.min(...rects.map(rect => rect.x))
  const y = Math.min(...rects.map(rect => rect.y))
  const width = Math.max(...rects.map(rect => rect.x + rect.width)) - x
  const height = Math.max(...rects.map(rect => rect.y + rect.height)) - y
  void reactFlow.fitBounds({ x, y, width, height }, { padding: 0.16, duration: options.duration })
}
