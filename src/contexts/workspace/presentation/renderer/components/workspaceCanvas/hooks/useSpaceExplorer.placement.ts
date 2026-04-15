import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { findNearestFreePositionOnRight, type Rect } from '../../../utils/collision'
import type { NodePlacementOptions, WorkspaceCanvasQuickPreviewState } from '../types'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'

export interface ExplorerPlacementPx {
  left: number
  top: number
  width: number
  height: number
}

interface ResolvedExplorerPlacement {
  anchor: Point
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
  preferredDirection?: NodePlacementOptions['preferredDirection']
}

function clampQuickPreviewRectToSpace(options: {
  position: Point
  size: { width: number; height: number }
  spaceRect: NonNullable<WorkspaceSpaceState['rect']>
}): WorkspaceCanvasQuickPreviewState['rect'] {
  const { position, size, spaceRect } = options
  const paddingX = 18
  const paddingY = 16
  const minX = spaceRect.x + paddingX
  const maxX = Math.max(minX, spaceRect.x + spaceRect.width - size.width - paddingX)
  const minY = spaceRect.y + paddingY
  const maxY = Math.max(minY, spaceRect.y + spaceRect.height - size.height - paddingY)

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
    width: size.width,
    height: size.height,
  }
}

export function resolveFlowRectPlacement(options: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  placementPx?: ExplorerPlacementPx
  spaceRect: WorkspaceSpaceState['rect']
  size: { width: number; height: number }
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
}): ResolvedExplorerPlacement & { rect: WorkspaceCanvasQuickPreviewState['rect'] } {
  const { canvasRef, reactFlow, placementPx, spaceRect, size, nodesRef, spacesRef } = options

  const baseAnchor = {
    x: spaceRect!.x + 24,
    y: spaceRect!.y + 46,
  }
  const resolveAnchoredRect = (clientPoint: { x: number; y: number } | null) => {
    if (!clientPoint) {
      return null
    }

    const topLeft = reactFlow.screenToFlowPosition(clientPoint)
    if (!Number.isFinite(topLeft.x) || !Number.isFinite(topLeft.y)) {
      return null
    }

    return clampQuickPreviewRectToSpace({
      position: topLeft,
      size,
      spaceRect: spaceRect!,
    })
  }

  const resolvedPlacement = (() => {
    const gapPx = 20
    const canvas = canvasRef.current

    if (placementPx && canvas) {
      const bounds = canvas.getBoundingClientRect()
      if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top)) {
        const anchoredRect = resolveAnchoredRect({
          x: bounds.left + placementPx.left + placementPx.width + gapPx,
          y: bounds.top + placementPx.top,
        })
        if (anchoredRect) {
          return {
            anchor: {
              x: anchoredRect.x,
              y: anchoredRect.y,
            },
            rect: anchoredRect,
            avoidRects: undefined,
            preferredDirection: 'right' as const,
          }
        }
      }
    }

    const explorerElement = document.querySelector(
      '[data-testid="workspace-space-explorer"]',
    ) as HTMLElement | null
    if (explorerElement) {
      const bounds = explorerElement.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        const anchoredRect = resolveAnchoredRect({
          x: bounds.right + gapPx,
          y: bounds.top,
        })
        if (anchoredRect) {
          return {
            anchor: {
              x: anchoredRect.x,
              y: anchoredRect.y,
            },
            rect: anchoredRect,
            avoidRects: undefined,
            preferredDirection: 'right' as const,
          }
        }
      }
    }

    const fallbackPlacement = resolveNodesPlacement({
      anchor: baseAnchor,
      size,
      getNodes: () => nodesRef.current,
      getSpaceRects: () =>
        spacesRef.current
          .map(space => space.rect)
          .filter(
            (rect): rect is { x: number; y: number; width: number; height: number } =>
              rect !== null,
          ),
      targetSpaceRect: spaceRect,
      preferredDirection: undefined,
      avoidRects: undefined,
    })

    return {
      anchor: baseAnchor,
      rect: {
        x: fallbackPlacement.placement.x,
        y: fallbackPlacement.placement.y,
        width: size.width,
        height: size.height,
      },
      avoidRects: undefined,
      preferredDirection: undefined,
    }
  })()

  return {
    anchor: resolvedPlacement.anchor,
    avoidRects: resolvedPlacement.avoidRects,
    preferredDirection: resolvedPlacement.preferredDirection,
    rect: resolvedPlacement.rect,
  }
}

export function resolveQuickPreviewObstacles(options: {
  rect: WorkspaceCanvasQuickPreviewState['rect']
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
}): Rect[] {
  const obstacles = options.avoidRects ?? []
  if (obstacles.length === 0) {
    return []
  }

  return obstacles.map(avoidRect => ({
    left: avoidRect.x,
    top: avoidRect.y,
    right: avoidRect.x + avoidRect.width,
    bottom: avoidRect.y + avoidRect.height,
  }))
}

export function resolveNearestFreePositionToRight(options: {
  anchor: Point
  size: { width: number; height: number }
  nodes: Array<Node<TerminalNodeData>>
  nodeId: string
  obstacles: Rect[]
}): Point | null {
  return (
    findNearestFreePositionOnRight(
      options.anchor,
      options.size,
      options.nodes,
      options.nodeId,
      options.obstacles,
    ) ?? null
  )
}
