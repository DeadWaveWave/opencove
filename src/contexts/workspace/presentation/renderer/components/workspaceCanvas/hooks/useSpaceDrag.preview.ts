import type { Dispatch, SetStateAction } from 'react'
import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import {
  areWorkspaceSnapGuidesEqual,
  resolveWorkspaceSnap,
  type WorkspaceSnapGuide,
} from '../../../utils/workspaceSnap'
import { SPACE_MIN_SIZE } from '../../../utils/spaceLayout'
import type { SpaceDragState } from '../types'

export function resolveResizedSpaceRect(
  dragState: SpaceDragState,
  dx: number,
  dy: number,
): WorkspaceSpaceRect {
  const initialRect = dragState.initialRect
  const handle = dragState.handle
  if (handle.kind !== 'resize') {
    return initialRect
  }

  const edges = handle.edges
  let nextX = initialRect.x
  let nextY = initialRect.y
  let nextWidth = initialRect.width
  let nextHeight = initialRect.height

  if (edges.right) {
    nextWidth = initialRect.width + dx
  }

  if (edges.left) {
    nextX = initialRect.x + dx
    nextWidth = initialRect.width - dx
  }

  if (edges.bottom) {
    nextHeight = initialRect.height + dy
  }

  if (edges.top) {
    nextY = initialRect.y + dy
    nextHeight = initialRect.height - dy
  }

  if (nextWidth < SPACE_MIN_SIZE.width) {
    if (edges.left && !edges.right) {
      nextX = initialRect.x + (initialRect.width - SPACE_MIN_SIZE.width)
    }

    nextWidth = SPACE_MIN_SIZE.width
  }

  if (nextHeight < SPACE_MIN_SIZE.height) {
    if (edges.top && !edges.bottom) {
      nextY = initialRect.y + (initialRect.height - SPACE_MIN_SIZE.height)
    }

    nextHeight = SPACE_MIN_SIZE.height
  }

  const ownedBounds = dragState.ownedBounds
  if (ownedBounds) {
    const nextLeft = Math.min(nextX, ownedBounds.left)
    const nextTop = Math.min(nextY, ownedBounds.top)
    const nextRight = Math.max(nextX + nextWidth, ownedBounds.right)
    const nextBottom = Math.max(nextY + nextHeight, ownedBounds.bottom)

    nextX = nextLeft
    nextY = nextTop
    nextWidth = Math.max(SPACE_MIN_SIZE.width, nextRight - nextLeft)
    nextHeight = Math.max(SPACE_MIN_SIZE.height, nextBottom - nextTop)
  }

  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  }
}

export function resolveSnappedSpaceMoveRect({
  spaceId,
  desiredRect,
  spaces,
  magneticSnappingEnabled,
  setSnapGuides,
  commit = false,
}: {
  spaceId: string
  desiredRect: WorkspaceSpaceRect
  spaces: WorkspaceSpaceState[]
  magneticSnappingEnabled: boolean
  setSnapGuides: Dispatch<SetStateAction<WorkspaceSnapGuide[] | null>>
  commit?: boolean
}): WorkspaceSpaceRect {
  if (!magneticSnappingEnabled) {
    setSnapGuides(current => (areWorkspaceSnapGuidesEqual(current, null) ? current : null))
    return desiredRect
  }

  const candidateRects = spaces
    .filter(space => space.id !== spaceId && space.rect)
    .map(space => space.rect!)

  const snapped = resolveWorkspaceSnap({
    movingRect: desiredRect,
    candidateRects,
    grid: WORKSPACE_ARRANGE_GRID_PX,
    threshold: 10,
    enableGrid: true,
    enableObject: true,
  })

  const nextGuides = snapped.guides.length > 0 ? snapped.guides : null
  setSnapGuides(current =>
    areWorkspaceSnapGuidesEqual(current, nextGuides) ? current : nextGuides,
  )

  if (!commit || (snapped.dx === 0 && snapped.dy === 0)) {
    return desiredRect
  }

  return {
    ...desiredRect,
    x: desiredRect.x + snapped.dx,
    y: desiredRect.y + snapped.dy,
  }
}
