import type { WindowKindFamily } from '../../../../utils/windowKindFamily'
import {
  pixelNoise,
  resolvePixelBuffer,
  type PixelActivity,
  type PixelNode,
  type PixelViewport,
} from './model'
import { drawPixelSparks, type PixelSpark } from './sparks'
import { drawWorkingPixels } from './workingRenderer'
import { drawDotRipples } from './dotRipples'
import type { Ripple } from '../pixelWall/ripples'

export interface PixelTheme {
  ink?: Record<WindowKindFamily, string>
  blue: string
  cyan: string
  mint: string
  warning: string
  danger: string
}

export function readPixelTheme(canvas: HTMLCanvasElement): PixelTheme {
  const style = getComputedStyle(canvas)
  const color = (token: string) => style.getPropertyValue(token).trim() || style.color
  return {
    ink: Object.fromEntries(
      Object.entries({
        ai: '--cove-pixel-blue',
        shell: '--cove-pixel-cyan',
        plan: '--cove-pixel-mint',
        knowledge: '--cove-pixel-blue',
        media: '--cove-pixel-cyan',
        neutral: '',
      }).map(([family, fallback]) => [
        family,
        style.getPropertyValue(`--cove-kind-${family}-ink`).trim() || color(fallback),
      ]),
    ) as Record<WindowKindFamily, string>,
    blue: color('--cove-pixel-blue'),
    cyan: color('--cove-pixel-cyan'),
    mint: color('--cove-pixel-mint'),
    warning: color('--cove-warning'),
    danger: color('--cove-danger'),
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
  ripples = [],
  rippleExclusions = [],
  working = false,
  workingNow = now,
  sparks = [],
}: {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  viewport: PixelViewport
  nodes: PixelNode[]
  activity: PixelActivity
  theme: PixelTheme
  now: number
  reducedMotion: boolean
  /** Status corner marks and output observation; the pixel wall paints the ambient background. */
  background?: boolean
  /** Output ripples through the dot grid (「简约」); under the pixel wall the wall draws them. */
  ripples?: readonly Ripple[]
  /** Windows the ripples leave dark. */
  rippleExclusions?: readonly { x: number; y: number; width: number; height: number }[]
  working?: boolean
  workingNow?: number
  sparks?: readonly PixelSpark[]
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

  activity.prune(nodes, now)
  let active = false
  for (const node of background ? nodes : []) {
    // Output shows as ripples now; the frame keeps only its status corner marks.
    active ||= !reducedMotion && activity.intensity(node, now) > 0
    drawNodePixels(context, node, 0, theme, gradient)
  }
  // The caller decides when ripples show. They sit under the patrol and the sparks, as the
  // prototype's dot canvas sits under its effects canvas.
  if (!reducedMotion && ripples.length > 0) {
    drawDotRipples(context, viewport, ripples, rippleExclusions)
  }
  if (working) {
    // Reduced motion keeps a static frame highlight instead of moving pixels.
    drawWorkingPixels(
      context,
      nodes,
      viewport,
      theme,
      reducedMotion ? null : workingNow,
      buffer.dpr,
    )
  }
  drawPixelSparks(context, sparks, viewport, buffer.dpr)
  active ||= sparks.length > 0
  context.globalAlpha = 1
  return active
}
