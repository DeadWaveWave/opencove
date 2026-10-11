import {
  pixelNoise,
  resolvePixelBuffer,
  type PixelActivity,
  type PixelNode,
  type PixelViewport,
} from './model'
import { drawPixelBackground } from './background'
import { drawWorkingPixels } from './workingRenderer'

export interface PixelTheme {
  blue: string
  cyan: string
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
    blue: color('--cove-pixel-blue'),
    cyan: color('--cove-pixel-cyan'),
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
  background = true,
  working = false,
  backgroundNow = now,
  workingNow = now,
}: {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  viewport: PixelViewport
  nodes: PixelNode[]
  activity: PixelActivity
  theme: PixelTheme
  now: number
  reducedMotion: boolean
  background?: boolean
  working?: boolean
  backgroundNow?: number
  workingNow?: number
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
  gradient.addColorStop(0, theme.blue)
  gradient.addColorStop(0.5, theme.cyan)
  gradient.addColorStop(1, theme.mint)
  context.fillStyle = gradient
  if (background) {
    drawPixelBackground(context, viewport, theme.gap, theme.opacity, backgroundNow, reducedMotion)
  }

  activity.prune(nodes, now)
  let active = false
  for (const node of background ? nodes : []) {
    const intensity = reducedMotion ? 0 : activity.intensity(node, now)
    active ||= intensity > 0
    drawNodePixels(context, node, intensity, theme, gradient)
  }
  if (working && !reducedMotion) {
    drawWorkingPixels(context, nodes, viewport, theme, workingNow)
  }
  context.globalAlpha = 1
  return active
}
