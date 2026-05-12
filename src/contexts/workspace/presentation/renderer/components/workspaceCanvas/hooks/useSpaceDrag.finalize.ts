import type { Node } from '@xyflow/react'
import { clampRectInsideRect } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { SpaceDragState } from '../types'
import { type LayoutDirection } from '../../../utils/spaceLayout'
import { projectWorkspacePushAwayLayout } from '../../../utils/workspacePushAwayProjection'
import { projectChildSpaceMoveWithinParent } from './useSpaceDrag.childProjection'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

type ResolveResizedRect = (dragState: SpaceDragState, dx: number, dy: number) => WorkspaceSpaceRect

const CHILD_SPACE_DRAG_PADDING = 12

export interface ProjectedSpaceDragLayout {
  nextSpaces: WorkspaceSpaceState[]
  nextNodePositionById: Map<string, { x: number; y: number }>
}

export function projectWorkspaceSpaceDragLayout({
  dragState,
  dx,
  dy,
  nodes,
  spaces,
  resolveResizedRect,
}: {
  dragState: SpaceDragState
  dx: number
  dy: number
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  resolveResizedRect: ResolveResizedRect
}): ProjectedSpaceDragLayout | null {
  const baselineNodes = restoreBaselineNodes(nodes, dragState.allNodePositions)
  const handle = dragState.handle
  const targetSpace = spaces.find(space => space.id === dragState.spaceId) ?? null
  const movedSpaceIds = new Set([
    dragState.spaceId,
    ...collectDescendantSpaceIds(spaces, dragState.spaceId),
  ])
  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)

  if (handle.kind === 'move') {
    const desiredRect: WorkspaceSpaceRect = {
      ...dragState.initialRect,
      x: dragState.initialRect.x + dx,
      y: dragState.initialRect.y + dy,
    }
    const nextRect = resolveContainedSpaceRect({
      desiredRect,
      space: targetSpace,
      spaces,
    })
    const effectiveDx = nextRect.x - dragState.initialRect.x
    const effectiveDy = nextRect.y - dragState.initialRect.y

    if (effectiveDx === 0 && effectiveDy === 0) {
      return {
        nextSpaces: spaces,
        nextNodePositionById: new Map(
          baselineNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
        ),
      }
    }

    const draftSpaces = spaces.map(space =>
      movedSpaceIds.has(space.id) && space.rect
        ? {
            ...space,
            rect: {
              ...space.rect,
              x: space.rect.x + effectiveDx,
              y: space.rect.y + effectiveDy,
            },
          }
        : space,
    )

    const draftNodes = baselineNodes.map(node => {
      const initial = dragState.initialNodePositions.get(node.id)
      const ownerSpaceId = owningSpaceIdByNodeId.get(node.id) ?? null
      if (!initial && (!ownerSpaceId || !movedSpaceIds.has(ownerSpaceId))) {
        return node
      }

      const baseline = initial ?? node.position
      return {
        ...node,
        position: {
          x: baseline.x + effectiveDx,
          y: baseline.y + effectiveDy,
        },
      }
    })

    if (targetSpace?.parentSpaceId) {
      const projected = projectChildSpaceMoveWithinParent({
        targetSpaceId: dragState.spaceId,
        parentSpaceId: targetSpace.parentSpaceId,
        draftSpaces,
        previousSpaces: spaces,
        draftNodes,
        movedSpaceIds,
        owningSpaceIdByNodeId,
        draggedNodeIds: new Set(dragState.initialNodePositions.keys()),
        directions: resolveMoveDirections(effectiveDx, effectiveDy),
        childSpaceDragPadding: CHILD_SPACE_DRAG_PADDING,
      })

      return propagateMovedParentDeltas({
        projected,
        previousSpaces: spaces,
        baselineNodes,
      })
    }

    const projected = projectWorkspacePushAwayLayout({
      spaces: draftSpaces,
      nodes: draftNodes,
      pinnedGroupIds: [...movedSpaceIds],
      sourceGroupIds: [dragState.spaceId],
      directions: resolveMoveDirections(effectiveDx, effectiveDy),
      gap: 0,
    })

    return propagateMovedParentDeltas({
      projected,
      previousSpaces: spaces,
      baselineNodes,
    })
  }

  const nextRect = resolveContainedSpaceRect({
    desiredRect: resolveResizedRect(dragState, dx, dy),
    space: targetSpace,
    spaces,
  })
  if (rectEquals(nextRect, dragState.initialRect)) {
    return null
  }

  const draftSpaces = spaces.map(space =>
    space.id === dragState.spaceId
      ? {
          ...space,
          rect: nextRect,
        }
      : space,
  )

  if (targetSpace?.parentSpaceId) {
    return {
      nextSpaces: draftSpaces,
      nextNodePositionById: new Map(),
    }
  }

  const pinnedResizeGroupIds = [
    dragState.spaceId,
    ...collectDescendantSpaceIds(spaces, dragState.spaceId),
  ]
  const projected = projectWorkspacePushAwayLayout({
    spaces: draftSpaces,
    nodes: baselineNodes,
    pinnedGroupIds: pinnedResizeGroupIds,
    sourceGroupIds: [dragState.spaceId],
    directions: resolveResizeDirections(dragState.initialRect, nextRect),
    gap: 0,
  })

  return propagateMovedParentDeltas({
    projected,
    previousSpaces: spaces,
    baselineNodes,
    excludeParentIds: new Set([dragState.spaceId]),
  })
}

export function finalizeWorkspaceSpaceDrag({
  dragState,
  dx,
  dy,
  nodes,
  spaces,
  resolveResizedRect,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
}: {
  dragState: SpaceDragState
  dx: number
  dy: number
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  resolveResizedRect: ResolveResizedRect
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}): void {
  const projected = projectWorkspaceSpaceDragLayout({
    dragState,
    dx,
    dy,
    nodes,
    spaces,
    resolveResizedRect,
  })

  if (!projected) {
    return
  }

  setNodes(
    prevNodes => {
      let hasChanged = false
      const nextNodes = prevNodes.map(node => {
        const nextPosition = projected.nextNodePositionById.get(node.id)
        if (!nextPosition) {
          return node
        }

        if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
          return node
        }

        hasChanged = true
        return {
          ...node,
          position: nextPosition,
        }
      })

      return hasChanged ? nextNodes : prevNodes
    },
    { syncLayout: false },
  )

  onSpacesChange(projected.nextSpaces)
  onRequestPersistFlush?.()
}

function restoreBaselineNodes(
  nodes: Node<TerminalNodeData>[],
  allNodePositions: Map<string, { x: number; y: number }>,
): Node<TerminalNodeData>[] {
  return nodes.map(node => {
    const baseline = allNodePositions.get(node.id)
    if (!baseline) {
      return node
    }

    if (node.position.x === baseline.x && node.position.y === baseline.y) {
      return node
    }

    return {
      ...node,
      position: baseline,
    }
  })
}

function rectEquals(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function collectDescendantSpaceIds(
  spaces: WorkspaceSpaceState[],
  rootSpaceId: string,
): Set<string> {
  const descendants = new Set<string>()
  let changed = true

  while (changed) {
    changed = false
    for (const space of spaces) {
      const parentSpaceId = space.parentSpaceId ?? null
      if (!parentSpaceId || descendants.has(space.id)) {
        continue
      }

      if (parentSpaceId === rootSpaceId || descendants.has(parentSpaceId)) {
        descendants.add(space.id)
        changed = true
      }
    }
  }

  return descendants
}

function buildOwningSpaceIdByNodeId(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const owningSpaceIdByNodeId = new Map<string, string>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      owningSpaceIdByNodeId.set(nodeId, space.id)
    }
  }

  return owningSpaceIdByNodeId
}

function resolveContainedSpaceRect({
  desiredRect,
  space,
  spaces,
}: {
  desiredRect: WorkspaceSpaceRect
  space: WorkspaceSpaceState | null
  spaces: WorkspaceSpaceState[]
}): WorkspaceSpaceRect {
  const parentSpaceId = space?.parentSpaceId ?? null
  if (!parentSpaceId) {
    return desiredRect
  }

  const parentRect = spaces.find(candidate => candidate.id === parentSpaceId)?.rect ?? null
  return parentRect
    ? clampRectInsideRect(desiredRect, parentRect, CHILD_SPACE_DRAG_PADDING)
    : desiredRect
}

function propagateMovedParentDeltas({
  projected,
  previousSpaces,
  baselineNodes,
  excludeParentIds = new Set(),
}: {
  projected: ProjectedSpaceDragLayout
  previousSpaces: WorkspaceSpaceState[]
  baselineNodes: Node<TerminalNodeData>[]
  excludeParentIds?: Set<string>
}): ProjectedSpaceDragLayout {
  const nextSpaceById = new Map(projected.nextSpaces.map(space => [space.id, space] as const))
  const previousSpaceById = new Map(previousSpaces.map(space => [space.id, space] as const))
  const baselineNodeById = new Map(baselineNodes.map(node => [node.id, node] as const))
  const nextNodePositionById = new Map(projected.nextNodePositionById)
  let nextSpaces = projected.nextSpaces

  for (const previousParent of previousSpaces) {
    if (excludeParentIds.has(previousParent.id) || !previousParent.rect) {
      continue
    }

    const nextParent = nextSpaceById.get(previousParent.id) ?? null
    if (!nextParent?.rect) {
      continue
    }

    const dx = nextParent.rect.x - previousParent.rect.x
    const dy = nextParent.rect.y - previousParent.rect.y
    if (dx === 0 && dy === 0) {
      continue
    }

    const descendantSpaceIds = collectDescendantSpaceIds(previousSpaces, previousParent.id)
    for (const descendantSpaceId of descendantSpaceIds) {
      const previousDescendant = previousSpaceById.get(descendantSpaceId) ?? null
      const nextDescendant = nextSpaceById.get(descendantSpaceId) ?? null
      if (!previousDescendant?.rect || !nextDescendant?.rect) {
        continue
      }

      const movedRect = {
        ...previousDescendant.rect,
        x: previousDescendant.rect.x + dx,
        y: previousDescendant.rect.y + dy,
      }
      nextSpaceById.set(descendantSpaceId, { ...nextDescendant, rect: movedRect })
      nextSpaces = nextSpaces.map(space =>
        space.id === descendantSpaceId ? { ...space, rect: movedRect } : space,
      )

      for (const nodeId of previousDescendant.nodeIds) {
        const baselineNode = baselineNodeById.get(nodeId) ?? null
        if (!baselineNode) {
          continue
        }

        nextNodePositionById.set(nodeId, {
          x: baselineNode.position.x + dx,
          y: baselineNode.position.y + dy,
        })
      }
    }
  }

  return {
    nextSpaces,
    nextNodePositionById,
  }
}

function resolveMoveDirections(dx: number, dy: number): LayoutDirection[] {
  const ordered: LayoutDirection[] = []
  const xDirection = dx >= 0 ? ('x+' as const) : ('x-' as const)
  const yDirection = dy >= 0 ? ('y+' as const) : ('y-' as const)

  if (Math.abs(dx) >= Math.abs(dy)) {
    ordered.push(xDirection, yDirection)
  } else {
    ordered.push(yDirection, xDirection)
  }

  if (!ordered.includes('y+')) {
    ordered.push('y+')
  }
  if (!ordered.includes('y-')) {
    ordered.push('y-')
  }
  if (!ordered.includes('x+')) {
    ordered.push('x+')
  }
  if (!ordered.includes('x-')) {
    ordered.push('x-')
  }

  return ordered
}

function resolveResizeDirections(
  initialRect: WorkspaceSpaceRect,
  nextRect: WorkspaceSpaceRect,
): LayoutDirection[] {
  const ordered: LayoutDirection[] = []

  if (nextRect.x < initialRect.x) {
    ordered.push('x-')
  }
  if (nextRect.x + nextRect.width > initialRect.x + initialRect.width) {
    ordered.push('x+')
  }
  if (nextRect.y < initialRect.y) {
    ordered.push('y-')
  }
  if (nextRect.y + nextRect.height > initialRect.y + initialRect.height) {
    ordered.push('y+')
  }

  if (!ordered.includes('y+')) {
    ordered.push('y+')
  }
  if (!ordered.includes('y-')) {
    ordered.push('y-')
  }
  if (!ordered.includes('x+')) {
    ordered.push('x+')
  }
  if (!ordered.includes('x-')) {
    ordered.push('x-')
  }

  return ordered
}
