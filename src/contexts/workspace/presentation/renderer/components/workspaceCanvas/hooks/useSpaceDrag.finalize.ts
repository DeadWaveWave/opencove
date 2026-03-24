import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { SpaceDragState } from '../types'
import { type LayoutDirection } from '../../../utils/spaceLayout'
import { projectWorkspacePushAwayLayout } from '../../../utils/workspacePushAwayProjection'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

type ResolveResizedRect = (dragState: SpaceDragState, dx: number, dy: number) => WorkspaceSpaceRect

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

  if (handle.kind === 'move') {
    if (dx === 0 && dy === 0) {
      return {
        nextSpaces: spaces,
        nextNodePositionById: new Map(
          baselineNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
        ),
      }
    }

    const nextRect: WorkspaceSpaceRect = {
      ...dragState.initialRect,
      x: dragState.initialRect.x + dx,
      y: dragState.initialRect.y + dy,
    }

    const draftSpaces = spaces.map(space =>
      space.id === dragState.spaceId
        ? {
            ...space,
            rect: nextRect,
          }
        : space,
    )

    const draftNodes = baselineNodes.map(node => {
      const initial = dragState.initialNodePositions.get(node.id)
      if (!initial) {
        return node
      }

      return {
        ...node,
        position: {
          x: initial.x + dx,
          y: initial.y + dy,
        },
      }
    })

    return projectWorkspacePushAwayLayout({
      spaces: draftSpaces,
      nodes: draftNodes,
      pinnedGroupIds: [dragState.spaceId],
      sourceGroupIds: [dragState.spaceId],
      directions: resolveMoveDirections(dx, dy),
      gap: 0,
    })
  }

  const nextRect = resolveResizedRect(dragState, dx, dy)
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

  return projectWorkspacePushAwayLayout({
    spaces: draftSpaces,
    nodes: baselineNodes,
    pinnedGroupIds: [dragState.spaceId],
    sourceGroupIds: [dragState.spaceId],
    directions: resolveResizeDirections(dragState.initialRect, nextRect),
    gap: 0,
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
