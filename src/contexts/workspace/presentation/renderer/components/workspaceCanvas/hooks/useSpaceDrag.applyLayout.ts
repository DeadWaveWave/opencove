import type * as React from 'react'
import type { WorkspaceSpaceRect } from '../../../types'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { SpaceDragState } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { projectWorkspaceSpaceDragLayout } from './useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from './useSpaceDrag.preview'

type SetNodes = UseWorkspaceCanvasNodesStoreResult['setNodes']

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
  readDocument,
  setNodes,
  setSpaceFramePreview,
}: {
  dragState: SpaceDragState
  dx: number
  dy: number
  readDocument: () => WorkspaceDocument
  setNodes: SetNodes
  setSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >
}): void {
  // Per frame: one read of the committed document, no write to it other than the node commit.
  const { nodes, spaces } = readDocument()
  const projected = projectWorkspaceSpaceDragLayout({
    dragState,
    dx,
    dy,
    nodes,
    spaces,
    resolveResizedRect: resolveResizedSpaceRect,
  })

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
