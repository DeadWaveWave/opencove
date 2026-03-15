import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { SpaceDragState } from '../types'
import { pushAwayLayout, type LayoutDirection, type LayoutItem } from '../../../utils/spaceLayout'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

type ApplySpaceDragNodePositions = (dragState: SpaceDragState, dx: number, dy: number) => void
type ResolveResizedRect = (dragState: SpaceDragState, dx: number, dy: number) => WorkspaceSpaceRect

export function finalizeWorkspaceSpaceDrag({
  dragState,
  dx,
  dy,
  nodes,
  spaces,
  applySpaceDragNodePositions,
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
  applySpaceDragNodePositions: ApplySpaceDragNodePositions
  resolveResizedRect: ResolveResizedRect
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}): void {
  const handle = dragState.handle

  if (handle.kind === 'move') {
    const shouldRestoreNodes = dx === 0 && dy === 0
    if (shouldRestoreNodes) {
      applySpaceDragNodePositions(dragState, 0, 0)
      return
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

    const draftNodes = nodes.map(node => {
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

    const directions: LayoutDirection[] = []
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    const xDir = dx === 0 ? null : dx > 0 ? ('x+' as const) : ('x-' as const)
    const yDir = dy === 0 ? null : dy > 0 ? ('y+' as const) : ('y-' as const)

    if (absDx >= absDy) {
      if (xDir) {
        directions.push(xDir)
      }
      if (yDir) {
        directions.push(yDir)
      }
    } else {
      if (yDir) {
        directions.push(yDir)
      }
      if (xDir) {
        directions.push(xDir)
      }
    }

    const ownedNodeIds = new Set(draftSpaces.flatMap(space => space.nodeIds))
    const items: LayoutItem[] = []

    const nodeById = new Map(draftNodes.map(node => [node.id, node]))
    for (const space of draftSpaces) {
      if (!space.rect) {
        continue
      }

      items.push({
        id: space.id,
        kind: 'space',
        groupId: space.id,
        rect: { ...space.rect },
      })

      for (const nodeId of space.nodeIds) {
        const node = nodeById.get(nodeId)
        if (!node) {
          continue
        }

        items.push({
          id: node.id,
          kind: 'node',
          groupId: space.id,
          rect: {
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          },
        })
      }
    }

    for (const node of draftNodes) {
      if (ownedNodeIds.has(node.id)) {
        continue
      }

      items.push({
        id: node.id,
        kind: 'node',
        groupId: node.id,
        rect: {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        },
      })
    }

    const pushed = pushAwayLayout({
      items,
      pinnedGroupIds: [dragState.spaceId],
      sourceGroupIds: [dragState.spaceId],
      directions,
      gap: 0,
    })

    const nextSpaceRectById = new Map(
      pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
    )
    const nextNodePositionById = new Map(
      pushed
        .filter(item => item.kind === 'node')
        .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    )

    const nextSpaces = draftSpaces.map(space => {
      const rect = nextSpaceRectById.get(space.id)
      if (!rect || !space.rect) {
        return space
      }

      if (
        rect.x === space.rect.x &&
        rect.y === space.rect.y &&
        rect.width === space.rect.width &&
        rect.height === space.rect.height
      ) {
        return space
      }

      return { ...space, rect }
    })

    setNodes(
      prevNodes => {
        let hasChanged = false
        const next = prevNodes.map(node => {
          const nextPosition = nextNodePositionById.get(node.id)
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

        return hasChanged ? next : prevNodes
      },
      { syncLayout: false },
    )

    onSpacesChange(nextSpaces)
    onRequestPersistFlush?.()
    return
  }

  const nextRect = resolveResizedRect(dragState, dx, dy)
  if (
    nextRect.x === dragState.initialRect.x &&
    nextRect.y === dragState.initialRect.y &&
    nextRect.width === dragState.initialRect.width &&
    nextRect.height === dragState.initialRect.height
  ) {
    return
  }

  const draftSpaces = spaces.map(space =>
    space.id === dragState.spaceId
      ? {
          ...space,
          rect: nextRect,
        }
      : space,
  )

  const expandedDirections: LayoutDirection[] = []
  const initialRect = dragState.initialRect
  if (nextRect.x < initialRect.x) {
    expandedDirections.push('x-')
  }
  if (nextRect.x + nextRect.width > initialRect.x + initialRect.width) {
    expandedDirections.push('x+')
  }
  if (nextRect.y < initialRect.y) {
    expandedDirections.push('y-')
  }
  if (nextRect.y + nextRect.height > initialRect.y + initialRect.height) {
    expandedDirections.push('y+')
  }

  const ownedNodeIds = new Set(draftSpaces.flatMap(space => space.nodeIds))
  const items: LayoutItem[] = []

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  for (const space of draftSpaces) {
    if (!space.rect) {
      continue
    }

    items.push({
      id: space.id,
      kind: 'space',
      groupId: space.id,
      rect: { ...space.rect },
    })

    for (const nodeId of space.nodeIds) {
      const node = nodeById.get(nodeId)
      if (!node) {
        continue
      }

      items.push({
        id: node.id,
        kind: 'node',
        groupId: space.id,
        rect: {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        },
      })
    }
  }

  for (const node of nodes) {
    if (ownedNodeIds.has(node.id)) {
      continue
    }

    items.push({
      id: node.id,
      kind: 'node',
      groupId: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      },
    })
  }

  const directions = expandedDirections.length > 0 ? expandedDirections : ['x+']

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [dragState.spaceId],
    sourceGroupIds: [dragState.spaceId],
    directions,
    gap: 0,
  })

  const nextSpaceRectById = new Map(
    pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
  )
  const nextNodePositionById = new Map(
    pushed
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  const nextSpaces = draftSpaces.map(space => {
    const rect = nextSpaceRectById.get(space.id)
    if (!rect || !space.rect) {
      return space
    }

    if (
      rect.x === space.rect.x &&
      rect.y === space.rect.y &&
      rect.width === space.rect.width &&
      rect.height === space.rect.height
    ) {
      return space
    }

    return { ...space, rect }
  })

  setNodes(
    prevNodes => {
      let hasChanged = false
      const next = prevNodes.map(node => {
        const nextPosition = nextNodePositionById.get(node.id)
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

      return hasChanged ? next : prevNodes
    },
    { syncLayout: false },
  )

  onSpacesChange(nextSpaces)
  onRequestPersistFlush?.()
}
