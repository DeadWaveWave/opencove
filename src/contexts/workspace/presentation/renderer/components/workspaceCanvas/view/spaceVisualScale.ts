import { resolvePixelDetail } from './pixelLayer/grid'

export const SPACE_VISUAL_SCALE_EVENT = 'cove-space-visual-scale'

/** Screen legibility is compensated only for captions and the painted boundary. */
export function resolveSpaceVisualScale(viewportZoom: number) {
  const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1
  return {
    zoom,
    overview: zoom < 0.4,
    detail: resolvePixelDetail(zoom),
    annotation: Math.max(1, Math.min(8, 0.8 / zoom)),
    // Chromium quantizes CSS border widths before the viewport transform.
    // Round up in world pixels so that quantization cannot erase the screen minimum.
    stroke: Math.max(1, Math.min(7, Math.ceil(0.7 / zoom))),
  }
}

/** Overview reserves room for the title and compact actions on separate rows. */
export function resolveSpaceAnnotationCap(width: number, overview = false): number {
  const captionBudget = overview ? 120 : 360
  return Number.isFinite(width) ? Math.max(1, (width - 32) / captionBudget) : 1
}
