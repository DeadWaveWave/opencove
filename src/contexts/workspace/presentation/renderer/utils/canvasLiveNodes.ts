import type { Node, XYPosition } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import { NODE_DRAG_HANDLE_SELECTOR } from './nodeFrameResize'

type FlowNode = Node<TerminalNodeData>

/** What the overlay holds for one node the gesture owns. */
export interface LiveNode {
  readonly position: XYPosition
  readonly dragging?: boolean
}

/**
 * The overlay of a node gesture: an entry for each window the gesture owns, by id, and nothing for
 * the others. A window the gesture did not move is not in it, so a move of that window from
 * elsewhere is shown, and survives the release.
 */
export type LiveNodes = ReadonlyMap<string, LiveNode>

/**
 * The entries of the nodes a gesture owns in `liveArray`: those marked as dragging by React Flow,
 * and those whose position differs from where the gesture's baseline put them and, when
 * `committedNodes` is given, from where the store holds them now. Every other node of the array is
 * left out. A node with no baseline entry, such as a window created during the gesture, is left
 * out unless it is dragging: the gesture never held it, so there is nothing to compare with.
 *
 * Two comparisons, because a frame's array holds a window the gesture did not move in one of two
 * places. The gesture's projection sets every baselined window it does not move back to its
 * baseline (a window that a write from elsewhere has moved is then at its baseline: only the
 * baseline comparison leaves it out); a frame that skips the projection of the others leaves such a
 * window where the store has it now (only the committed comparison leaves it out). Either one alone
 * would put the window in the overlay and mask the next move of it from elsewhere.
 */
export function toLiveNodes(
  liveArray: readonly FlowNode[],
  baselinePositionById: ReadonlyMap<string, XYPosition> | null,
  committedNodes: readonly FlowNode[] | null = null,
): LiveNodes {
  const committedById = committedNodes ? new Map(committedNodes.map(node => [node.id, node])) : null
  const entries = new Map<string, LiveNode>()

  for (const node of liveArray) {
    const baseline = baselinePositionById?.get(node.id)
    const committed = committedById?.get(node.id)
    const isMoved =
      baseline !== undefined &&
      (baseline.x !== node.position.x || baseline.y !== node.position.y) &&
      (committed === undefined ||
        committed.position.x !== node.position.x ||
        committed.position.y !== node.position.y)
    if (!isMoved && node.dragging !== true) {
      continue
    }

    entries.set(
      node.id,
      node.dragging === undefined
        ? { position: { x: node.position.x, y: node.position.y } }
        : { position: { x: node.position.x, y: node.position.y }, dragging: node.dragging },
    )
  }

  return entries
}

/** The same ids with the same positions and flags (`undefined` and `false` agree). */
export function areLiveNodesEqual(left: LiveNodes | null, right: LiveNodes | null): boolean {
  if (left === right) {
    return true
  }

  if (left === null || right === null || left.size !== right.size) {
    return false
  }

  for (const [id, entry] of left) {
    const other = right.get(id)
    if (
      !other ||
      entry.position.x !== other.position.x ||
      entry.position.y !== other.position.y ||
      (entry.dragging ?? false) !== (other.dragging ?? false)
    ) {
      return false
    }
  }

  return true
}

/**
 * What React Flow shows while a gesture runs: the committed nodes with the gesture's overlay
 * applied. The one derivation of the live view; the host evaluates it at render and the change path
 * at call time. The release applies the release's entries to the store's nodes with the same
 * function.
 *
 * A node with an entry takes the entry's `position` and `dragging`; membership and every other
 * field come from `committed`, so a title changed from elsewhere is shown and a node added or
 * removed from elsewhere is added or dropped (an entry of a node that is gone is ignored). A node
 * the overlay has no entry for is the committed one. Returns `committed` itself when `overlay` is
 * null or no entry changes a node, and keeps the committed object of a node an entry agrees with.
 */
export function applyLiveNodes(committed: FlowNode[], overlay: LiveNodes | null): FlowNode[] {
  if (overlay === null || overlay.size === 0) {
    return committed
  }

  let didChange = false

  const applied = committed.map(node => {
    const entry = overlay.get(node.id)
    if (
      !entry ||
      (entry.position.x === node.position.x &&
        entry.position.y === node.position.y &&
        (entry.dragging ?? false) === (node.dragging ?? false))
    ) {
      return node
    }

    didChange = true
    return { ...node, position: entry.position, dragging: entry.dragging }
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
