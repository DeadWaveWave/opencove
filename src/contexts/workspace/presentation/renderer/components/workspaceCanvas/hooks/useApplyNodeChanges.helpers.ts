import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { areWorkspaceSnapGuidesEqual, type WorkspaceSnapGuide } from '../../../utils/workspaceSnap'

export interface UseApplyNodeChangesParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  clearAgentLaunchToken: (nodeId: string) => void
  normalizePosition: (
    nodeId: string,
    desired: { x: number; y: number },
    size: { width: number; height: number },
  ) => { x: number; y: number }
  applyPendingScrollbacks: (targetNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]
  isNodeDraggingRef: MutableRefObject<boolean>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  selectedSpaceIdsRef: MutableRefObject<string[]>
  dragSelectedSpaceIdsRef?: MutableRefObject<string[] | null>
  magneticSnappingEnabledRef: MutableRefObject<boolean>
  setSnapGuides: Dispatch<SetStateAction<WorkspaceSnapGuide[] | null>>
  exclusiveNodeDragAnchorIdRef?: MutableRefObject<string | null>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  setSpaceFramePreview?: Dispatch<SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>>
  nodeDragPointerAnchorRef?: MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
}

export function setResolvedSnapGuides(
  setSnapGuides: Dispatch<SetStateAction<WorkspaceSnapGuide[] | null>>,
  guides: WorkspaceSnapGuide[] | null,
): void {
  setSnapGuides(current => (areWorkspaceSnapGuidesEqual(current, guides) ? current : guides))
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

function areSpaceFramePreviewMapsEqual(
  a: ReadonlyMap<string, WorkspaceSpaceRect> | null,
  b: ReadonlyMap<string, WorkspaceSpaceRect> | null,
): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  if (a.size !== b.size) {
    return false
  }

  for (const [spaceId, rect] of a.entries()) {
    const other = b.get(spaceId)
    if (!other) {
      return false
    }

    if (!areSpaceRectsEqual(rect, other)) {
      return false
    }
  }

  return true
}

export function setResolvedSpaceFramePreview(
  setSpaceFramePreview: Dispatch<SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>>,
  nextPreview: ReadonlyMap<string, WorkspaceSpaceRect> | null,
): void {
  setSpaceFramePreview(current =>
    areSpaceFramePreviewMapsEqual(current, nextPreview) ? current : nextPreview,
  )
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
