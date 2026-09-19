import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import {
  collectSpaceNodeIds,
  getCollapsedSpaceSize,
  type CanvasCollapseState,
} from '../../../utils/canvasCollapse'
export function projectSpaceDisplayRect(
  rect: WorkspaceSpaceRect,
  collapsed: boolean,
  nodeCount: number,
): WorkspaceSpaceRect {
  if (collapsed) {
    return { ...rect, ...getCollapsedSpaceSize(nodeCount) }
  }
  return rect
}

export function resolveSpaceDisplayRect(
  spaceId: string,
  rect: WorkspaceSpaceRect,
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): WorkspaceSpaceRect {
  return projectSpaceDisplayRect(
    rect,
    state.collapsedSpaceIds[spaceId] === true,
    collectSpaceNodeIds(spaceId, spaces).size,
  )
}
