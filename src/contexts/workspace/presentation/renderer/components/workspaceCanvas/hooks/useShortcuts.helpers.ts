import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { isAgentWorking } from '../helpers'
import {
  resolveSpatialNavigationTargetId,
  type SpatialCandidate,
  type SpatialNavigationDirection,
} from './spatialNavigation'

export type SpaceCycleDirection = 'next' | 'previous'

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export function resolveCanvasVisualCenter(rect: RectLike): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function resolveCycledSpaceId({
  direction,
  activeSpaceId,
  spaceIds,
}: {
  direction: SpaceCycleDirection
  activeSpaceId: string | null
  spaceIds: string[]
}): string | null {
  if (spaceIds.length === 0) {
    return null
  }

  const activeIndex = activeSpaceId ? spaceIds.indexOf(activeSpaceId) : -1
  if (activeIndex === -1) {
    return direction === 'next' ? spaceIds[0] : spaceIds[spaceIds.length - 1]
  }

  const delta = direction === 'next' ? 1 : -1
  return spaceIds[(activeIndex + delta + spaceIds.length) % spaceIds.length]
}

export function resolveIdleSpaceIds({
  nodes,
  spaces,
}: {
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
}): string[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))

  return spaces
    .filter(space =>
      space.nodeIds.every(nodeId => {
        const node = nodeById.get(nodeId)
        if (!node || node.data.kind !== 'agent') {
          return true
        }

        return !isAgentWorking(node.data.status)
      }),
    )
    .map(space => space.id)
}

function toSpatialRectFromNode(node: Node<TerminalNodeData>) {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.data.width,
    bottom: node.position.y + node.data.height,
  }
}

function toSpatialRectFromSpaceRect(rect: NonNullable<WorkspaceSpaceState['rect']>) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  }
}

export function resolveNodeNavigationTargetId({
  direction,
  sourceNodeId,
  nodes,
  spaces,
  viewportRect,
}: {
  direction: SpatialNavigationDirection
  sourceNodeId: string | null
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
  viewportRect: { left: number; top: number; right: number; bottom: number }
}): { targetNodeId: string; targetSpaceId: string | null } | null {
  const nodeById = new Map(nodes.map(node => [node.id, node] as const))

  const spaceIdByNodeId = new Map<string, string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!spaceIdByNodeId.has(nodeId)) {
        spaceIdByNodeId.set(nodeId, space.id)
      }
    }
  }

  const sourceRect = (() => {
    if (sourceNodeId) {
      const node = nodeById.get(sourceNodeId) ?? null
      if (node) {
        return toSpatialRectFromNode(node)
      }
    }

    const anchorCenterX = viewportRect.left + (viewportRect.right - viewportRect.left) / 2
    const anchorCenterY = viewportRect.top + (viewportRect.bottom - viewportRect.top) / 2

    return {
      left: anchorCenterX,
      top: anchorCenterY,
      right: anchorCenterX + 1,
      bottom: anchorCenterY + 1,
    }
  })()

  const candidates: SpatialCandidate[] = nodes
    .filter(node => node.id !== sourceNodeId)
    .map(node => ({
      id: node.id,
      rect: toSpatialRectFromNode(node),
    }))

  const targetNodeId = resolveSpatialNavigationTargetId({
    direction,
    source: sourceRect,
    candidates,
  })

  if (!targetNodeId) {
    return null
  }

  return { targetNodeId, targetSpaceId: spaceIdByNodeId.get(targetNodeId) ?? null }
}

export function resolveSpaceNavigationTargetId({
  direction,
  sourceNodeId,
  spaceNavigationAnchorId,
  spaces,
  viewportRect,
}: {
  direction: SpatialNavigationDirection
  sourceNodeId: string | null
  spaceNavigationAnchorId: string | null
  spaces: WorkspaceSpaceState[]
  viewportRect: { left: number; top: number; right: number; bottom: number }
}): string | null {
  const spaceIdByNodeId = new Map<string, string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!spaceIdByNodeId.has(nodeId)) {
        spaceIdByNodeId.set(nodeId, space.id)
      }
    }
  }

  const sourceSpaceId = sourceNodeId ? (spaceIdByNodeId.get(sourceNodeId) ?? null) : null
  const resolvedAnchorSpaceId = (() => {
    if (!spaceNavigationAnchorId) {
      return null
    }

    const anchorSpace = spaces.find(space => space.id === spaceNavigationAnchorId) ?? null
    return anchorSpace?.rect ? anchorSpace.id : null
  })()
  const viewportAnchorSpaceId = (() => {
    const centerX = viewportRect.left + (viewportRect.right - viewportRect.left) / 2
    const centerY = viewportRect.top + (viewportRect.bottom - viewportRect.top) / 2

    for (const space of spaces) {
      if (!space.rect) {
        continue
      }

      const { x, y, width, height } = space.rect
      if (centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height) {
        return space.id
      }
    }

    return null
  })()

  const resolvedSourceSpaceId = sourceSpaceId ?? resolvedAnchorSpaceId ?? viewportAnchorSpaceId

  const sourceRect = (() => {
    if (resolvedSourceSpaceId) {
      const sourceSpace = spaces.find(space => space.id === resolvedSourceSpaceId) ?? null
      if (sourceSpace?.rect) {
        return toSpatialRectFromSpaceRect(sourceSpace.rect)
      }
    }

    const anchorCenterX = viewportRect.left + (viewportRect.right - viewportRect.left) / 2
    const anchorCenterY = viewportRect.top + (viewportRect.bottom - viewportRect.top) / 2

    return {
      left: anchorCenterX,
      top: anchorCenterY,
      right: anchorCenterX + 1,
      bottom: anchorCenterY + 1,
    }
  })()

  const candidates: SpatialCandidate[] = spaces
    .filter(space => space.rect !== null)
    .filter(space => space.id !== resolvedSourceSpaceId)
    .map(space => ({
      id: space.id,
      rect: toSpatialRectFromSpaceRect(space.rect!),
    }))

  return resolveSpatialNavigationTargetId({
    direction,
    source: sourceRect,
    candidates,
  })
}
