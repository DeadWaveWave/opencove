import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData } from '../../../types'
import { resolveWorkspaceNodesPlacement } from '@contexts/workspace/domain/workspaceNodePlacement'
import type { NodePlacementDirection } from '../types'

export function resolveNodesPlacement({
  anchor,
  size,
  getNodes,
  getSpaceRects,
  targetSpaceRect,
  preferredDirection,
  avoidRects,
}: {
  anchor: Point
  size: Size
  getNodes: () => Node<TerminalNodeData>[]
  getSpaceRects?: () => Array<{ x: number; y: number; width: number; height: number }>
  targetSpaceRect?: { x: number; y: number; width: number; height: number } | null
  preferredDirection?: NodePlacementDirection
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
}): { placement: Point; canPlace: boolean } {
  return resolveWorkspaceNodesPlacement({
    anchor,
    size,
    nodes: getNodes(),
    spaceRects: getSpaceRects?.() ?? [],
    targetSpaceRect,
    preferredDirection,
    avoidRects,
  })
}
