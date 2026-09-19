import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { isPointInsideRect } from './useSpaceOwnership.helpers'
import { getPresentedNodeSize } from '../../../utils/canvasInteractionLayout'

interface SelectionRectNodeToggleEvent {
  button: number
  shiftKey: boolean
  target: EventTarget | null
  clientX: number
  clientY: number
  preventDefault: () => void
  stopPropagation: () => void
}

interface HandleSelectionRectNodeToggleParams {
  event: SelectionRectNodeToggleEvent
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  toggleNode: (nodeId: string) => void
  queueIgnoreNextPaneClick: () => void
}

export function handleSelectionRectNodeToggle({
  event,
  reactFlow,
  toggleNode,
  queueIgnoreNextPaneClick,
}: HandleSelectionRectNodeToggleParams): boolean {
  if (event.button !== 0 || !event.shiftKey) {
    return false
  }

  if (!(event.target instanceof Element)) {
    return false
  }

  if (!event.target.closest('.react-flow__nodesselection-rect')) {
    return false
  }

  const point = reactFlow.screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  })

  const targetNode = reactFlow.getNodes().find(
    node =>
      node.selected &&
      !node.data.collapsePresentation?.spaceHidden &&
      isPointInsideRect(point, {
        x: node.position.x,
        y: node.position.y,
        ...getPresentedNodeSize(node.data),
      }),
  )

  if (!targetNode) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  toggleNode(targetNode.id)
  queueIgnoreNextPaneClick()
  return true
}
