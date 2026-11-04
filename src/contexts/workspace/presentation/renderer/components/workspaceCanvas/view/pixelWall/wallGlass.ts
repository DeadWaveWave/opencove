import type { WallViewport } from './wallGrid'

/** Window frames on screen, packed as x, y, width, height for an instanced draw. */
export interface WallGlass {
  rects: Float32Array
  count: number
  /** Screen radius of the windows' corners. */
  radius: number
}

/**
 * Where the frosted glass goes: every window that is at least partly in view, in CSS px.
 * `radiusWorld` is the windows' corner radius on the canvas, which scales with the zoom.
 */
export function projectWallGlass(
  windows: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  view: WallViewport,
  radiusWorld: number,
  out?: Float32Array,
): WallGlass {
  const rects = out && out.length >= windows.length * 4 ? out : new Float32Array(windows.length * 4)
  let count = 0
  for (const frame of windows) {
    const x = frame.x * view.zoom + view.x
    const y = frame.y * view.zoom + view.y
    const width = frame.width * view.zoom
    const height = frame.height * view.zoom
    if (x + width <= 0 || y + height <= 0 || x >= view.width || y >= view.height) {
      continue
    }
    rects.set([x, y, width, height], count * 4)
    count++
  }
  return { rects, count, radius: radiusWorld * view.zoom }
}

/** The windows' corner radius on the canvas (`--cove-node-radius`), in world px. */
export function readWallGlassRadius(element: Element): number {
  const radius = Number.parseFloat(getComputedStyle(element).getPropertyValue('--cove-node-radius'))
  return Number.isFinite(radius) && radius >= 0 ? radius : 12
}
