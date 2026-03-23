import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { pushAwayLayout, SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import { sanitizeSpaces } from '../helpers'

interface SetNodes {
  (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ): void
}

export function findContainingSpaceByAnchor(
  spaces: WorkspaceSpaceState[],
  anchor: Point,
): WorkspaceSpaceState | null {
  return (
    spaces.find(space => {
      if (!space.rect) {
        return false
      }

      return (
        anchor.x >= space.rect.x &&
        anchor.x <= space.rect.x + space.rect.width &&
        anchor.y >= space.rect.y &&
        anchor.y <= space.rect.y + space.rect.height
      )
    }) ?? null
  )
}

export function assignNodeToSpaceAndExpand({
  createdNodeId,
  targetSpaceId,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  createdNodeId: string
  targetSpaceId: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const targetRect = spacesRef.current.find(space => space.id === targetSpaceId)?.rect ?? null
  const createdNode = nodesRef.current.find(node => node.id === createdNodeId) ?? null

  if (targetRect && createdNode) {
    const innerLeft = targetRect.x + SPACE_NODE_PADDING
    const innerTop = targetRect.y + SPACE_NODE_PADDING
    const innerRight = targetRect.x + targetRect.width - SPACE_NODE_PADDING
    const innerBottom = targetRect.y + targetRect.height - SPACE_NODE_PADDING

    const maxWidth = Math.max(0, innerRight - innerLeft)
    const maxHeight = Math.max(0, innerBottom - innerTop)

    const nodeRect = {
      x: createdNode.position.x,
      y: createdNode.position.y,
      width: createdNode.data.width,
      height: createdNode.data.height,
    }

    let dx = 0
    let dy = 0

    if (nodeRect.width > maxWidth) {
      dx = innerLeft - nodeRect.x
    } else if (nodeRect.x < innerLeft) {
      dx = innerLeft - nodeRect.x
    } else if (nodeRect.x + nodeRect.width > innerRight) {
      dx = innerRight - (nodeRect.x + nodeRect.width)
    }

    if (nodeRect.height > maxHeight) {
      dy = innerTop - nodeRect.y
    } else if (nodeRect.y < innerTop) {
      dy = innerTop - nodeRect.y
    } else if (nodeRect.y + nodeRect.height > innerBottom) {
      dy = innerBottom - (nodeRect.y + nodeRect.height)
    }

    if (dx !== 0 || dy !== 0) {
      setNodes(
        prevNodes =>
          prevNodes.map(node => {
            if (node.id !== createdNodeId) {
              return node
            }

            const nextPosition = {
              x: node.position.x + dx,
              y: node.position.y + dy,
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            return {
              ...node,
              position: nextPosition,
            }
          }),
        { syncLayout: false },
      )
    }
  }

  const nextSpaces = sanitizeSpaces(
    spacesRef.current.map(space => {
      const filtered = space.nodeIds.filter(nodeId => nodeId !== createdNodeId)

      if (space.id !== targetSpaceId) {
        return { ...space, nodeIds: filtered }
      }

      return { ...space, nodeIds: [...new Set([...filtered, createdNodeId])] }
    }),
  )

  const targetSpaceNodeIds = nextSpaces.find(space => space.id === targetSpaceId)?.nodeIds ?? []
  if (targetSpaceNodeIds.length > 1) {
    const nodeById = new Map(nodesRef.current.map(node => [node.id, node]))
    const ownedItems = targetSpaceNodeIds
      .map(nodeId => nodeById.get(nodeId))
      .filter((node): node is Node<TerminalNodeData> => Boolean(node))
      .map(node => ({
        id: node.id,
        kind: 'node' as const,
        groupId: node.id,
        rect: {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        },
      }))

    if (ownedItems.length > 1) {
      const pushedOwnedItems = pushAwayLayout({
        items: ownedItems,
        pinnedGroupIds: [createdNodeId],
        sourceGroupIds: [createdNodeId],
        directions: ['x+', 'y+', 'x-', 'y-'],
        gap: 0,
      })

      const pushedOwnedPositionById = new Map(
        pushedOwnedItems.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
      )

      if (pushedOwnedPositionById.size > 0) {
        setNodes(
          prevNodes => {
            let hasChanged = false
            const nextNodes = prevNodes.map(node => {
              const nextPosition = pushedOwnedPositionById.get(node.id)
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
      }
    }
  }

  const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
    targetSpaceId,
    spaces: nextSpaces,
    nodeRects: nodesRef.current.map(node => ({
      id: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      },
    })),
    gap: 0,
  })

  if (nodePositionById.size > 0) {
    setNodes(
      prevNodes => {
        let hasChanged = false
        const nextNodes = prevNodes.map(node => {
          const nextPosition = nodePositionById.get(node.id)
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
  }

  onSpacesChange(pushedSpaces)
}
