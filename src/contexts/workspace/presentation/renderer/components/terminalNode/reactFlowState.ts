type ReactFlowCoveState = {
  coveDragSurfaceSelectionMode?: boolean
  coveViewportInteractionActive?: boolean
}

export function selectDragSurfaceSelectionMode(state: unknown): boolean {
  return (state as ReactFlowCoveState).coveDragSurfaceSelectionMode ?? false
}

export function selectViewportInteractionActive(state: unknown): boolean {
  return (state as ReactFlowCoveState).coveViewportInteractionActive ?? false
}
