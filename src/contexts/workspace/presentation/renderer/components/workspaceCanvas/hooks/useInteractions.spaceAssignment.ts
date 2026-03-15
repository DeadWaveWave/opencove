import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
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
  const nextSpaces = sanitizeSpaces(
    spacesRef.current.map(space => {
      const filtered = space.nodeIds.filter(nodeId => nodeId !== createdNodeId)

      if (space.id !== targetSpaceId) {
        return { ...space, nodeIds: filtered }
      }

      return { ...space, nodeIds: [...new Set([...filtered, createdNodeId])] }
    }),
  )

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
