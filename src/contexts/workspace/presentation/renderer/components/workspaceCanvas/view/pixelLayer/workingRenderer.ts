import type { PixelNode, PixelViewport } from './model'
import type { PixelTheme } from './renderer'

/** Pixels in each of the two trains. */
const TRAIN_LENGTH = 7
/** Screen px per second a train travels at zoom 1. */
const TRAIN_SPEED = 180
/** Spacing of the still outline under reduced motion, in screen px. */
const OUTLINE_STEP = 28

/** The point `distance` px along a rect's perimeter, clockwise from its top left corner. */
function pointOnFrame(
  rect: { x: number; y: number; width: number; height: number },
  distance: number,
): { x: number; y: number } {
  const { x, y, width, height } = rect
  const perimeter = 2 * (width + height)
  let d = ((distance % perimeter) + perimeter) % perimeter
  if (d < width) {
    return { x: x + d, y }
  }
  d -= width
  if (d < height) {
    return { x: x + width, y: y + d }
  }
  d -= height
  if (d < width) {
    return { x: x + width - d, y: y + height }
  }
  return { x, y: y + height - (d - width) }
}

/**
 * The Working patrol (Tide 5.4b): two strings of pixels travel around the outside of a working
 * agent's frame, on opposite sides. A decorative projection of authoritative Working status,
 * never a PTY heuristic. Only pixels in view are drawn, so oversized windows cost no more.
 * Without a clock (reduced motion) the frame keeps a still dotted outline instead.
 */
export function drawWorkingPixels(
  context: CanvasRenderingContext2D,
  nodes: PixelNode[],
  viewport: PixelViewport,
  theme: Pick<PixelTheme, 'blue' | 'cyan' | 'mint'>,
  now: number | null,
): boolean {
  let active = false
  const scale = Math.min(1, Math.max(0.4, viewport.zoom))
  const inView = (point: { x: number; y: number }) =>
    point.x >= -8 &&
    point.y >= -8 &&
    point.x <= viewport.width + 8 &&
    point.y <= viewport.height + 8
  for (const node of nodes) {
    if (node.tone !== 'working') {
      continue
    }
    const offset = 6 * scale
    const frame = {
      x: node.rect.x - offset,
      y: node.rect.y - offset,
      width: node.rect.width + offset * 2,
      height: node.rect.height + offset * 2,
    }
    if (
      frame.x > viewport.width ||
      frame.y > viewport.height ||
      frame.x + frame.width < 0 ||
      frame.y + frame.height < 0
    ) {
      continue
    }
    const gradient = context.createLinearGradient(
      frame.x,
      frame.y,
      frame.x + frame.width,
      frame.y + frame.height,
    )
    gradient.addColorStop(0, theme.blue)
    gradient.addColorStop(0.5, theme.cyan)
    gradient.addColorStop(1, theme.mint)
    context.fillStyle = gradient
    const perimeter = 2 * (frame.width + frame.height)
    if (now === null) {
      const size = 2 * scale
      for (let along = 0; along < perimeter; along += OUTLINE_STEP * scale) {
        const point = pointOnFrame(frame, along)
        if (inView(point)) {
          context.globalAlpha = 0.32
          context.fillRect(point.x - size / 2, point.y - size / 2, size, size)
        }
      }
      continue
    }
    const seed = [...node.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 0)
    const head = (now / 1000) * TRAIN_SPEED * scale + Math.abs(seed % 997)
    for (let train = 0; train < 2; train++) {
      for (let pixel = 0; pixel < TRAIN_LENGTH; pixel++) {
        const point = pointOnFrame(frame, head + (train * perimeter) / 2 - pixel * 7 * scale)
        if (!inView(point)) {
          continue
        }
        const size = (3.2 - pixel * 0.28) * scale
        context.globalAlpha = 0.9 * (1 - pixel / TRAIN_LENGTH)
        context.fillRect(point.x - size / 2, point.y - size / 2, size, size)
      }
    }
    active = true
  }
  context.globalAlpha = 1
  return active
}
