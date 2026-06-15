import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'

export const LIVE_DRAG_LAYOUT_MIN_DISTANCE_PX = 24
export const LIVE_DRAG_LAYOUT_MIN_INTERVAL_MS = 120

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

export interface LastLiveDragLayoutProjection {
  anchorPoint: { x: number; y: number } | null
  draggedNodeKey: string
  projectedAtMs: number
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

export function shouldResolveLiveDragLayoutProjection({
  lastProjection,
  draggedNodeKey,
  anchorPoint,
  nowMs,
}: {
  lastProjection: LastLiveDragLayoutProjection | null
  draggedNodeKey: string
  anchorPoint: { x: number; y: number } | null
  nowMs: number
}): boolean {
  if (!lastProjection) {
    return true
  }

  if (lastProjection.draggedNodeKey !== draggedNodeKey) {
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

  if (distanceSquared >= LIVE_DRAG_LAYOUT_MIN_DISTANCE_PX * LIVE_DRAG_LAYOUT_MIN_DISTANCE_PX) {
    return true
  }

  return nowMs - lastProjection.projectedAtMs >= LIVE_DRAG_LAYOUT_MIN_INTERVAL_MS
}
