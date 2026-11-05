import { resolvePixelDetail } from './pixelLayer/grid'
import { CANVAS_FAR_ENTER_ZOOM } from './canvasLod'

export const SPACE_VISUAL_SCALE_EVENT = 'cove-space-visual-scale'

const OVERVIEW_ZOOM = 0.4

function resolveCaptionScreenFactor(zoom: number): number {
  if (zoom >= OVERVIEW_ZOOM) {
    return 0.8
  }
  if (zoom <= CANVAS_FAR_ENTER_ZOOM) {
    return 1.4
  }
  return 1.4 - ((zoom - CANVAS_FAR_ENTER_ZOOM) / (OVERVIEW_ZOOM - CANVAS_FAR_ENTER_ZOOM)) * 0.6
}

/** Screen legibility is compensated only for captions and the painted boundary. */
export function resolveSpaceVisualScale(viewportZoom: number) {
  const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0 ? viewportZoom : 1
  return {
    zoom,
    overview: zoom < OVERVIEW_ZOOM,
    detail: resolvePixelDetail(zoom),
    // Captions hold about 8.8px on screen down to 40% zoom, then grow to about 15px by far view
    // (25%), where the Space name is what you read.
    annotation: Math.max(
      1,
      Math.min(12, Math.round((resolveCaptionScreenFactor(zoom) / zoom) * 1000) / 1000),
    ),
    // Chromium quantizes CSS border widths before the viewport transform.
    // Round up in world pixels so that quantization cannot erase the screen minimum.
    stroke: Math.max(1, Math.min(7, Math.ceil(0.7 / zoom))),
    // Window identity stripes stay about one screen pixel thick. Half-pixel steps mean the value,
    // which every window inherits, changes a few times across the zoom range instead of every step.
    identityStripe: Math.max(2, Math.min(6, Math.round(2 / zoom) / 2)),
  }
}

/** Overview reserves room for the title and compact actions on separate rows. */
export function resolveSpaceAnnotationCap(width: number, overview = false): number {
  const captionBudget = overview ? 120 : 360
  return Number.isFinite(width) ? Math.max(1, (width - 32) / captionBudget) : 1
}
