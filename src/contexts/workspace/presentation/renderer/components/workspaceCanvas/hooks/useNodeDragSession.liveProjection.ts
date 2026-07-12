import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'

export const LIVE_DRAG_SECONDARY_MIN_DISTANCE_PX = 24
export const LIVE_DRAG_SECONDARY_MIN_INTERVAL_MS = 120

export interface DragLayoutProjectionInput {
  currentNodes: Node<TerminalNodeData>[]
  draggedNodeIds: string[]
  desiredDraggedPositionById: Map<string, { x: number; y: number }>
  dropFlowPoint: { x: number; y: number } | null
  anchorNodeId: string | null
  anchorIsSelected: boolean
}

export interface DragLayoutProjectionResult {
  nextNodes: Node<TerminalNodeData>[]
  nextDraggedNodePositionById: Map<string, { x: number; y: number }>
  nextSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
}

export interface LastLiveDragSecondaryProjection {
  anchorPoint: { x: number; y: number } | null
  draggedNodeKey: string
  projectedAtMs: number
  targetSpaceId: string | null
}

export function readDragLayoutTimeMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }

  return Date.now()
}

export function buildDraggedNodeKey(draggedNodeIds: string[]): string {
  return draggedNodeIds.join('\u0000')
}

export function resolveDragLayoutAnchorPoint({
  anchorNodeId,
  draggedNodeIds,
  desiredDraggedPositionById,
}: {
  anchorNodeId: string | null
  draggedNodeIds: string[]
  desiredDraggedPositionById: Map<string, { x: number; y: number }>
}): { x: number; y: number } | null {
  const resolvedAnchorNodeId = anchorNodeId ?? draggedNodeIds[0] ?? null
  return resolvedAnchorNodeId
    ? (desiredDraggedPositionById.get(resolvedAnchorNodeId) ?? null)
    : null
}

export function shouldResolveLiveDragSecondaryProjection({
  lastProjection,
  draggedNodeKey,
  anchorPoint,
  nowMs,
  targetSpaceId,
}: {
  lastProjection: LastLiveDragSecondaryProjection | null
  draggedNodeKey: string
  anchorPoint: { x: number; y: number } | null
  nowMs: number
  targetSpaceId: string | null
}): boolean {
  if (!lastProjection || lastProjection.draggedNodeKey !== draggedNodeKey) {
    return true
  }

  if (lastProjection.targetSpaceId !== targetSpaceId) {
    return true
  }

  if (!anchorPoint || !lastProjection.anchorPoint) {
    return anchorPoint !== lastProjection.anchorPoint
  }

  const dx = anchorPoint.x - lastProjection.anchorPoint.x
  const dy = anchorPoint.y - lastProjection.anchorPoint.y
  const distanceSquared = dx * dx + dy * dy
  if (distanceSquared === 0) {
    return false
  }

  if (
    distanceSquared >=
    LIVE_DRAG_SECONDARY_MIN_DISTANCE_PX * LIVE_DRAG_SECONDARY_MIN_DISTANCE_PX
  ) {
    return true
  }

  return nowMs - lastProjection.projectedAtMs >= LIVE_DRAG_SECONDARY_MIN_INTERVAL_MS
}
