import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession'

export interface UseApplyNodeChangesParams {
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  onNodesCommit?: (nodes: Node<TerminalNodeData>[]) => void
  onSelectedNodeIdsChange?: (nodeIds: string[]) => void
  clearAgentLaunchToken: (nodeId: string) => void
  normalizePosition: (
    nodeId: string,
    desired: { x: number; y: number },
    size: { width: number; height: number },
  ) => { x: number; y: number }
  applyPendingScrollbacks: (targetNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]
  isNodeDraggingRef: MutableRefObject<boolean>
  exclusiveNodeDragAnchorIdRef?: MutableRefObject<string | null>
  nodeDragSession: WorkspaceCanvasNodeDragSession
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
