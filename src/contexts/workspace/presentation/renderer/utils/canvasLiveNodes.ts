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
 * left out. A node with no baseline entry, such as a window created during the gesture, is compared
 * with the store only: the gesture never held it, so a window the gesture pushes is its own and
 * one it leaves where the store has it is not.
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
      (baseline === undefined ||
        baseline.x !== node.position.x ||
        baseline.y !== node.position.y) &&
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

/**
 * What a release writes to the document: the positions of `release`'s entries, applied to the
 * store's nodes, and nothing else of them. `dragging` belongs to the overlay and the view
 * (`applyLiveNodes`); the document holds no canvas-only field. Keeps the object of a node an entry
 * agrees with, and returns `nodes` itself when no entry moves a node. An entry of a node that is
 * gone is ignored.
 */
export function applyReleasedPositions(nodes: FlowNode[], release: LiveNodes): FlowNode[] {
  if (release.size === 0) {
    return nodes
  }

  let didChange = false

  const applied = nodes.map(node => {
    const entry = release.get(node.id)
    if (!entry || (entry.position.x === node.position.x && entry.position.y === node.position.y)) {
      return node
    }

    didChange = true
    return { ...node, position: entry.position }
  })

  return didChange ? applied : nodes
}

/**
 * The view of each committed node, the last one `decorateFlowNodes` built for it. Weakly held and
 * keyed by the committed node object (not its id), so a write that replaces a node can never be
 * answered with the view of its predecessor, and a node that leaves the document is collected.
 */
const decoratedViews = new WeakMap<FlowNode, FlowNode>()

/**
 * `selected` and `dragHandle` derived from the selection: the one place the committed view of the
 * canvas gets them. The document holds neither, so a committed node never equals its own view; the
 * cache is what keeps the view object of a node whose flags and committed object did not change,
 * and with it React Flow's wrapper of that node (`adoptUserNodes` renders a wrapper whenever its
 * user node is a new object). Returns a new array, as `nodes.map` does.
 */
export function decorateFlowNodes(
  nodes: FlowNode[],
  selectedNodeIdSet: ReadonlySet<string>,
  isDragSurfaceSelectionMode: boolean,
): FlowNode[] {
  return nodes.map(node => {
    const isSelected = selectedNodeIdSet.has(node.id)
    const dragHandle =
      isSelected && isDragSurfaceSelectionMode ? undefined : NODE_DRAG_HANDLE_SELECTOR

    // A node that already carries the derived flags is its own view (a view fed back in).
    if (node.selected === isSelected && node.dragHandle === dragHandle) {
      return node
    }

    const cached = decoratedViews.get(node)
    if (cached && cached.selected === isSelected && cached.dragHandle === dragHandle) {
      return cached
    }

    const view = {
      ...node,
      selected: isSelected,
      dragHandle,
    }
    decoratedViews.set(node, view)
    return view
  })
}
