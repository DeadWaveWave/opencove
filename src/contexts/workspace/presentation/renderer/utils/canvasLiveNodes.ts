import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import { NODE_DRAG_HANDLE_SELECTOR } from './nodeFrameResize'

type FlowNode = Node<TerminalNodeData>

/**
 * What React Flow shows while a gesture runs: the committed nodes with the gesture's live array
 * applied. The one derivation of the live view; the host evaluates it at render and the change path
 * at call time.
 *
 * A committed node whose live counterpart has another position takes the live `position` and
 * `dragging`; membership and every other field come from `committed`, so a title changed from
 * elsewhere is shown and a node added or removed from elsewhere is added or dropped. Returns
 * `committed` itself when `live` is null or nothing differs.
 *
 * This is the rule as it has been (S6, PR 3): the live array holds every node's position as of the
 * last frame, so an external move of a node the gesture did not move is masked by the old live
 * position. A later pull request narrows the overlay to the nodes the gesture moved.
 */
export function applyLiveNodes(
  committed: FlowNode[],
  live: readonly FlowNode[] | null,
): FlowNode[] {
  if (live === null) {
    return committed
  }

  const liveById = new Map(live.map(node => [node.id, node]))
  let didChange = false

  const applied = committed.map(node => {
    const liveNode = liveById.get(node.id)
    if (
      !liveNode ||
      (liveNode.position.x === node.position.x && liveNode.position.y === node.position.y)
    ) {
      return node
    }

    didChange = true
    return { ...node, position: liveNode.position, dragging: liveNode.dragging }
  })

  return didChange ? applied : committed
}

/** `selected` and `dragHandle` derived from the selection; unchanged nodes keep their identity. */
export function decorateFlowNodes(
  nodes: FlowNode[],
  selectedNodeIdSet: ReadonlySet<string>,
  isDragSurfaceSelectionMode: boolean,
): FlowNode[] {
  return nodes.map(node => {
    const isSelected = selectedNodeIdSet.has(node.id)
    const dragHandle =
      isSelected && isDragSurfaceSelectionMode ? undefined : NODE_DRAG_HANDLE_SELECTOR

    if (node.selected === isSelected && node.dragHandle === dragHandle) {
      return node
    }

    return {
      ...node,
      selected: isSelected,
      dragHandle,
    }
  })
}
