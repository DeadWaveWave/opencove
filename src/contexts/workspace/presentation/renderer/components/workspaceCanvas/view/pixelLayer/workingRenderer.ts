import type { PixelNode, PixelViewport } from './model'
import type { PixelTheme } from './renderer'
import { pointOnFrame } from './perimeter'

/** A read-only projection of Working; no per-window timers or runtime-state writes. */
export function drawWorkingPixels(
  context: CanvasRenderingContext2D,
  nodes: PixelNode[],
  viewport: PixelViewport,
  theme: Pick<PixelTheme, 'ink' | 'blue'>,
  now: number | null,
  dpr = 1,
): boolean {
  let active = false
  const snap = (value: number) => Math.round(value * dpr) / dpr
  const inView = (point: { x: number; y: number }) =>
    point.x >= -8 &&
    point.y >= -8 &&
    point.x <= viewport.width + 8 &&
    point.y <= viewport.height + 8
  for (const node of nodes) {
    if (node.tone !== 'working') {
      continue
    }
    const rect = node.rect
    if (
      rect.x > viewport.width + 40 ||
      rect.y > viewport.height + 40 ||
      rect.x + rect.width < -40 ||
      rect.y + rect.height < -40
    ) {
      continue
    }
    const frame = { x: rect.x - 6, y: rect.y - 6, width: rect.width + 12, height: rect.height + 12 }
    context.fillStyle = theme.ink?.[node.family ?? 'ai'] ?? theme.blue
    if (now === null) {
      // Tide's reduced-motion table asks for a static frame highlight, without a patrol.
      context.globalAlpha = 0.32
      context.fillRect(snap(frame.x), snap(frame.y), frame.width, 1)
      context.fillRect(snap(frame.x), snap(frame.y + frame.height - 1), frame.width, 1)
      context.fillRect(snap(frame.x), snap(frame.y), 1, frame.height)
      context.fillRect(snap(frame.x + frame.width - 1), snap(frame.y), 1, frame.height)
      continue
    }
    const seed =
      ([...node.id].reduce((sum, char) => Math.imul(sum, 31) + char.charCodeAt(0), 0) >>> 0) /
      4294967295
    const perimeter = 2 * (rect.width + rect.height)
    // tide-spec.html:1966–1972: 240 world px/s; phase uses the unexpanded perimeter.
    // Screen projection leaves the 6px offset, 11px spacing and 3.5/2.5px sizes constant.
    const head = (now / 1000) * 240 * viewport.zoom + seed * perimeter
    for (const shift of [0, perimeter / 2]) {
      for (let pixel = 0; pixel < 8; pixel++) {
        const point = pointOnFrame(frame, head + shift - pixel * 11)
        if (!inView(point)) {
          continue
        }
        const size = pixel === 0 ? 3.5 : 2.5
        context.globalAlpha = 1 - pixel / 8
        context.fillRect(snap(point.x - size / 2), snap(point.y - size / 2), size, size)
      }
    }
    active = true
  }
  context.globalAlpha = 1
  return active
}
