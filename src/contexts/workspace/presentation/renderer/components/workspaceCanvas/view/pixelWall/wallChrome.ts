import type { WallGlass } from './wallGlass'
import type { WallViewport } from './wallGrid'

/** A rectangle on the wall, in CSS px from the wall's top left corner. */
export interface WallScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the canvas sits on the wall. The wall fills the app window (Tide: the shell floats on
 * it as glass); the canvas is the region of it the flow transform describes.
 */
export interface WallPlacement {
  width: number
  height: number
  canvas: WallScreenRect
}

/** The flow transform, moved from the canvas's corner to the wall's. */
export function placeWallViewport(
  transform: { x: number; y: number; zoom: number },
  placement: WallPlacement,
): WallViewport {
  return {
    x: transform.x + placement.canvas.x,
    y: transform.y + placement.canvas.y,
    zoom: transform.zoom,
    width: placement.width,
    height: placement.height,
  }
}

/**
 * The shell's chrome on the wall: everything outside the canvas (the top bar and the sidebar,
 * in whatever layout), as at most four bands that never overlap. Top and bottom bands span the
 * wall's width; side bands fill the rows between them.
 */
export function resolveWallChrome({ width, height, canvas }: WallPlacement): WallScreenRect[] {
  const left = Math.min(width, Math.max(0, canvas.x))
  const top = Math.min(height, Math.max(0, canvas.y))
  const right = Math.max(left, Math.min(width, canvas.x + canvas.width))
  const bottom = Math.max(top, Math.min(height, canvas.y + canvas.height))
  const bands: WallScreenRect[] = []
  if (top > 0) {
    bands.push({ x: 0, y: 0, width, height: top })
  }
  if (bottom < height) {
    bands.push({ x: 0, y: bottom, width, height: height - bottom })
  }
  if (left > 0 && bottom > top) {
    bands.push({ x: 0, y: top, width: left, height: bottom - top })
  }
  if (right < width && bottom > top) {
    bands.push({ x: right, y: top, width: width - right, height: bottom - top })
  }
  return bands
}

/** The chrome as frosted glass for the renderers: square corners, packed like window glass. */
export function packWallChrome(bands: readonly WallScreenRect[], out?: Float32Array): WallGlass {
  const rects = out && out.length >= bands.length * 4 ? out : new Float32Array(bands.length * 4)
  bands.forEach((band, index) => rects.set([band.x, band.y, band.width, band.height], index * 4))
  return { rects, count: bands.length, radius: 0 }
}
