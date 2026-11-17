import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { LiveNodes } from '../../../utils/canvasLiveNodes'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession'

/** What a release writes: the gesture's windows, what the batch removed, the frame rects. */
export interface NodesRelease {
  /** `toLiveNodes` of the release array: the windows the gesture owns, at their release position. */
  liveNodes: LiveNodes
  /** The windows the releasing batch removes (a remove batch that arrives mid-gesture). */
  removedIds: ReadonlySet<string>
  /** The Space frames of a Space-dominant release; null for any other. */
  spaceRects: ReadonlyMap<string, WorkspaceSpaceRect> | null
}

export interface UseApplyNodeChangesParams {
  /** A drag frame: the overlay of the gesture's windows. */
  onNodesChange: (liveNodes: LiveNodes) => void
  /** Any other batch: the whole result, computed from the committed view. */
  onNodesCommit: (nodes: Node<TerminalNodeData>[]) => void
  /** A release: one write of the gesture's windows and Space frames. */
  onNodesRelease: (release: NodesRelease) => void
  onSelectedNodeIdsChange?: (nodeIds: string[]) => void
  clearAgentLaunchToken: (nodeId: string) => void
  normalizePosition: (
    nodeId: string,
    desired: { x: number; y: number },
    size: { width: number; height: number },
  ) => { x: number; y: number }
  applyPendingScrollbacks: (targetNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]
  /** The committed nodes: a drag whose grabbed window leaves them has been aborted. */
  nodes: Node<TerminalNodeData>[]
  isNodeDraggingRef: MutableRefObject<boolean>
  exclusiveNodeDragAnchorIdRef?: MutableRefObject<string | null>
  nodeDragSession: WorkspaceCanvasNodeDragSession
}

/** The Spaces with the rects of a released frame; the same array when no rect changes. */
export function applySpaceFramePreview(
  spaces: WorkspaceSpaceState[],
  preview: ReadonlyMap<string, WorkspaceSpaceRect>,
): WorkspaceSpaceState[] {
  let hasSpaceChange = false
  const nextSpaces = spaces.map(space => {
    const rect = preview.get(space.id) ?? null
    if (!rect) {
      return space
    }

    if (space.rect && areSpaceRectsEqual(space.rect, rect)) {
      return space
    }

    hasSpaceChange = true
    return { ...space, rect: { ...rect } }
  })

  return hasSpaceChange ? nextSpaces : spaces
}

export function areSpaceRectsEqual(
  a: WorkspaceSpaceRect | null,
  b: WorkspaceSpaceRect | null,
): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function buildDragBaselineNodes({
  nodes,
  baselinePositionById,
  shiftNodeIds,
  shiftDx = 0,
  shiftDy = 0,
}: {
  nodes: Node<TerminalNodeData>[]
  baselinePositionById: Map<string, { x: number; y: number }> | null
  shiftNodeIds: Set<string> | null
  shiftDx?: number
  shiftDy?: number
}): Node<TerminalNodeData>[] {
  if (!baselinePositionById) {
    return nodes
  }

  return nodes.map(node => {
    const baseline = baselinePositionById.get(node.id)
    if (!baseline) {
      return node
    }

    const shouldShiftBaseline =
      shiftNodeIds?.has(node.id) === true && (shiftDx !== 0 || shiftDy !== 0)
    const resolvedBaseline = shouldShiftBaseline
      ? { x: baseline.x + shiftDx, y: baseline.y + shiftDy }
      : baseline

    if (node.position.x === resolvedBaseline.x && node.position.y === resolvedBaseline.y) {
      return node
    }

    return { ...node, position: resolvedBaseline }
  })
}

/**
 * The window a live node drag was grabbed by, or null when that cannot be told. React Flow aborts a
 * node-handle drag, and sends no release, when this window leaves the document. The pointer anchor
 * names it while the overlay still holds that window: an anchor that no gesture of this overlay
 * dragged is a stale one, left by an earlier drag. Without an anchor (a touch drag), a drag that
 * moves exactly one window grabbed that window.
 */
export function resolveGrabbedNodeId(
  pointerAnchor: { nodeId: string } | null,
  liveNodes: LiveNodes | null,
): string | null {
  if (pointerAnchor && liveNodes?.get(pointerAnchor.nodeId)?.dragging === true) {
    return pointerAnchor.nodeId
  }

  let draggedId: string | null = null
  let draggedCount = 0
  for (const [id, entry] of liveNodes ?? []) {
    if (entry.dragging === true) {
      draggedId = id
      draggedCount += 1
    }
  }

  return draggedCount === 1 ? draggedId : null
}
