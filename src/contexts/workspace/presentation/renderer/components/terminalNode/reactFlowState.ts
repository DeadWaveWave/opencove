type ReactFlowCoveState = {
  coveDragSurfaceSelectionMode?: boolean
  coveViewportInteractionActive?: boolean
  transform?: [number, number, number]
}

export function selectViewportZoom(state: unknown): number {
  const zoom = (state as ReactFlowCoveState).transform?.[2] ?? 1
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

export function selectDragSurfaceSelectionMode(state: unknown): boolean {
  return (state as ReactFlowCoveState).coveDragSurfaceSelectionMode ?? false
}

export function selectViewportInteractionActive(state: unknown): boolean {
  return (state as ReactFlowCoveState).coveViewportInteractionActive ?? false
}
