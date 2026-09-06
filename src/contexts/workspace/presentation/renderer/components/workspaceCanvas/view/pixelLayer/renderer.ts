import {
  pixelNoise,
  resolvePixelBuffer,
  resolvePixelGrid,
  type PixelActivity,
  type PixelNode,
  type PixelViewport,
} from './model'
import { createPixelFieldColumn, resolvePixelScanFront } from './field'

export interface PixelTheme {
  violet: string
  blue: string
  mint: string
  warning: string
  danger: string
  gap: number
  opacity: number
}

export function readPixelTheme(canvas: HTMLCanvasElement): PixelTheme {
  const style = getComputedStyle(canvas)
  const color = (token: string) => style.getPropertyValue(token).trim() || style.color
  const opacity = Number.parseFloat(style.getPropertyValue('--cove-pixel-grid-opacity'))
  return {
    violet: color('--cove-pixel-violet'),
    blue: color('--cove-pixel-blue'),
    mint: color('--cove-pixel-mint'),
    warning: color('--cove-warning'),
    danger: color('--cove-danger'),
    gap: Number.parseFloat(style.getPropertyValue('--cove-pixel-grid-gap')) || 17,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(0.8, opacity)) : 0,
  }
}

function drawNodePixels(
  context: CanvasRenderingContext2D,
  node: PixelNode,
  intensity: number,
  theme: PixelTheme,
  gradient: CanvasGradient,
): void {
  if (!node.tone && intensity <= 0) {
    return
  }
  context.fillStyle =
    node.tone === 'warning' ? theme.warning : node.tone === 'danger' ? theme.danger : gradient
  const { x, y, width, height } = node.rect
  const baseAlpha = node.tone ? 0.22 : 0
  const seed = [...node.id].reduce(
    (value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) | 0,
    0,
  )
  // Sparse pixels outside the frame cannot cover text, selection or terminal chrome.
  for (let index = 0; index < 20; index++) {
    const fraction = index / 19
    const noise = pixelNoise(index, seed)
    const corner = index < 2 || index > 17
    if (!corner && intensity <= 0) {
      continue
    }
    const alpha = (corner ? baseAlpha : 0) + intensity * (0.12 + noise * 0.42)
    const size = 1.2 + intensity * (0.6 + noise * 1.2)
    const offset = 3 + (1 - intensity) * noise * 3
    context.globalAlpha = Math.min(0.65, alpha)
    context.fillRect(x + width * fraction, y - offset - size, size, size)
    context.fillRect(x + width * fraction, y + height + offset, size, size)
    context.fillRect(x - offset - size, y + height * fraction, size, size)
    context.fillRect(x + width + offset, y + height * fraction, size, size)
  }
}

export function drawPixelLayer({
  canvas,
  context,
  viewport,
  nodes,
  activity,
  theme,
  now,
  reducedMotion,
}: {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  viewport: PixelViewport
  nodes: PixelNode[]
  activity: PixelActivity
  theme: PixelTheme
  now: number
  reducedMotion: boolean
}): boolean {
  const buffer = resolvePixelBuffer(viewport.width, viewport.height, window.devicePixelRatio)
  if (canvas.width !== buffer.width) {
    canvas.width = buffer.width
  }
  if (canvas.height !== buffer.height) {
    canvas.height = buffer.height
  }
  context.setTransform(buffer.dpr, 0, 0, buffer.dpr, 0, 0)
  context.clearRect(0, 0, viewport.width, viewport.height)
  if (viewport.width <= 0 || viewport.height <= 0 || viewport.zoom <= 0) {
    return false
  }

  const gradient = context.createLinearGradient(0, 0, viewport.width, viewport.height)
  gradient.addColorStop(0, theme.violet)
  gradient.addColorStop(0.5, theme.blue)
  gradient.addColorStop(1, theme.mint)
  context.fillStyle = gradient
  const grid = resolvePixelGrid(viewport, theme.gap)
  const columns = Math.ceil(viewport.width / grid.gap) + 1
  const rows = Math.ceil(viewport.height / grid.gap) + 1
  for (let column = grid.firstColumn; column <= grid.firstColumn + columns; column++) {
    const x = column * grid.gap + viewport.x
    const sample = createPixelFieldColumn(x, viewport.height, now, reducedMotion)
    for (let row = grid.firstRow; row <= grid.firstRow + rows; row++) {
      const y = row * grid.gap + viewport.y
      const noise = pixelNoise(column * grid.worldGap, row * grid.worldGap)
      const cell = sample(y, noise)
      context.globalAlpha = theme.opacity * cell.alpha
      context.fillRect(x - cell.size / 2, y - cell.size / 2, cell.size, cell.size)
    }
  }
  if (!reducedMotion) {
    for (let lane = 0; lane < 3; lane++) {
      for (let row = grid.firstRow; row <= grid.firstRow + rows; row++) {
        const noise = pixelNoise(row * grid.worldGap, lane)
        if (noise < 0.5) {
          continue
        }
        const y = row * grid.gap + viewport.y
        const front = resolvePixelScanFront(lane, y, viewport.width, now, noise)
        context.globalAlpha = theme.opacity * front.alpha
        context.fillRect(front.x - front.size / 2, y - front.size / 2, front.size, front.size)
      }
    }
  }

  activity.prune(nodes, now)
  let active = false
  for (const node of nodes) {
    const intensity = reducedMotion ? 0 : activity.intensity(node, now)
    active ||= intensity > 0
    drawNodePixels(context, node, intensity, theme, gradient)
  }
  context.globalAlpha = 1
  return active
}
