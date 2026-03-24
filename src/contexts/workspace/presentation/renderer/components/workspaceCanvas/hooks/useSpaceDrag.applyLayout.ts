import type * as React from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { SpaceDragState } from '../types'
import { projectWorkspaceSpaceDragLayout } from './useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from './useSpaceDrag.preview'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

function areSpaceRectsEqual(a: WorkspaceSpaceRect | null, b: WorkspaceSpaceRect | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function areSpaceFramePreviewMapsEqual(
  a: ReadonlyMap<string, WorkspaceSpaceRect> | null,
  b: ReadonlyMap<string, WorkspaceSpaceRect> | null,
): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  if (a.size !== b.size) {
    return false
  }

  for (const [spaceId, rect] of a.entries()) {
    const other = b.get(spaceId)
    if (!other) {
      return false
    }

    if (!areSpaceRectsEqual(rect, other)) {
      return false
    }
  }

  return true
}

function setResolvedSpaceFramePreview(
  setSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >,
  nextPreview: ReadonlyMap<string, WorkspaceSpaceRect> | null,
): void {
  setSpaceFramePreview(current =>
    areSpaceFramePreviewMapsEqual(current, nextPreview) ? current : nextPreview,
  )
}

export function applyProjectedWorkspaceSpaceDragLayout({
  dragState,
  dx,
  dy,
  nodesRef,
  spacesRef,
  setNodes,
  setSpaceFramePreview,
}: {
  dragState: SpaceDragState
  dx: number
  dy: number
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  setNodes: SetNodes
  setSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >
}): void {
  const projected = projectWorkspaceSpaceDragLayout({
    dragState,
    dx,
    dy,
    nodes: nodesRef.current,
    spaces: spacesRef.current,
    resolveResizedRect: resolveResizedSpaceRect,
  })

  if (!projected) {
    setResolvedSpaceFramePreview(
      setSpaceFramePreview,
      new Map(
        spacesRef.current
          .filter(space => space.rect)
          .map(space => [space.id, space.rect!] as const),
      ),
    )
    setNodes(
      prevNodes => {
        let hasMoved = false
        const nextNodes = prevNodes.map(node => {
          const baseline = dragState.allNodePositions.get(node.id)
          if (!baseline) {
            return node
          }

          if (node.position.x === baseline.x && node.position.y === baseline.y) {
            return node
          }

          hasMoved = true
          return {
            ...node,
            position: baseline,
          }
        })

        return hasMoved ? nextNodes : prevNodes
      },
      { syncLayout: false },
    )
    return
  }

  setResolvedSpaceFramePreview(
    setSpaceFramePreview,
    new Map(
      projected.nextSpaces
        .filter(space => space.rect)
        .map(space => [space.id, space.rect!] as const),
    ),
  )

  setNodes(
    prevNodes => {
      let hasMoved = false
      const nextNodes = prevNodes.map(node => {
        const nextPosition = projected.nextNodePositionById.get(node.id)
        if (!nextPosition) {
          return node
        }

        if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
          return node
        }

        hasMoved = true
        return {
          ...node,
          position: nextPosition,
        }
      })

      return hasMoved ? nextNodes : prevNodes
    },
    { syncLayout: false },
  )
}
