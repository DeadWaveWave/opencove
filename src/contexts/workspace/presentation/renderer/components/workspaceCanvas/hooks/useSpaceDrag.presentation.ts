import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE, getCollapsedSpaceHiddenIds } from '../../../utils/canvasCollapse'
import { resolveSpaceDisplayRect } from '../collapse/spacePresentation'
import { resolveSnappedSpaceMoveRect } from './useSpaceDrag.preview'

export function readSpaceDragDisplayRect(
  workspaceId: string,
  spaceId: string,
  rect: WorkspaceSpaceRect,
  spaces: WorkspaceSpaceState[],
) {
  const state = useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
  return resolveSpaceDisplayRect(spaceId, rect, spaces, state)
}

export function resolveSpaceMoveWithPresentation({
  workspaceId,
  spaceId,
  desiredRect,
  spaces,
  ...options
}: {
  workspaceId: string
  spaceId: string
  desiredRect: WorkspaceSpaceRect
  spaces: WorkspaceSpaceState[]
  magneticSnappingEnabled: boolean
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  commit?: boolean
}): WorkspaceSpaceRect {
  const state = useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
  const display = resolveSpaceDisplayRect(spaceId, desiredRect, spaces, state)
  const hidden = getCollapsedSpaceHiddenIds(spaces, state.collapsedSpaceIds).spaceIds
  const snapped = resolveSnappedSpaceMoveRect({
    ...options,
    spaceId,
    desiredRect: display,
    spaces: spaces
      .filter(space => !hidden.has(space.id))
      .map(space =>
        space.rect
          ? { ...space, rect: resolveSpaceDisplayRect(space.id, space.rect, spaces, state) }
          : space,
      ),
  })
  return {
    ...desiredRect,
    x: desiredRect.x + snapped.x - display.x,
    y: desiredRect.y + snapped.y - display.y,
  }
}
