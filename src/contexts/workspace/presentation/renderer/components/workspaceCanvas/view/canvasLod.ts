/**
 * Two levels of detail for the canvas (Tide phase 4). Below 25% every expanded window is drawn as
 * a glass tile with its kind, title and status; above 28% windows are themselves again. The gap
 * keeps the view from flickering at the boundary. Website windows freeze their native view on
 * the same thresholds, so the canvas has one notion of "far".
 */
export const CANVAS_FAR_ENTER_ZOOM = 0.25
export const CANVAS_FAR_EXIT_ZOOM = 0.28

export type CanvasLod = 'near' | 'far'

/** The canvas root carries the current level; useSpaceVisualScale is its only writer. */
export const CANVAS_LOD_ATTRIBUTE = 'data-cove-lod'

export function resolveCanvasLod(zoom: number, previous: CanvasLod, enabled = true): CanvasLod {
  if (!enabled || !Number.isFinite(zoom) || zoom <= 0) {
    return 'near'
  }
  return zoom <= (previous === 'far' ? CANVAS_FAR_EXIT_ZOOM : CANVAS_FAR_ENTER_ZOOM)
    ? 'far'
    : 'near'
}
