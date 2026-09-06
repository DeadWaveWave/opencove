import { buildPixelAssemblyScene, type PixelAssemblyFrame } from './assembly'
import type { PixelViewport } from './geometry'
import { resolvePixelBuffer } from './model'

export interface PixelAssemblyTheme {
  blue: string
  cyan: string
  mint: string
}

export function readPixelAssemblyTheme(canvas: HTMLCanvasElement): PixelAssemblyTheme {
  const style = getComputedStyle(canvas)
  const color = (name: string) => style.getPropertyValue(name).trim() || style.color
  return {
    blue: color('--cove-pixel-blue'),
    cyan: color('--cove-pixel-cyan'),
    mint: color('--cove-pixel-mint'),
  }
}

export function drawPixelAssemblies({
  canvas,
  context,
  viewport,
  frames,
  theme,
}: {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  viewport: PixelViewport
  frames: PixelAssemblyFrame[]
  theme: PixelAssemblyTheme
}): void {
  const buffer = resolvePixelBuffer(viewport.width, viewport.height, window.devicePixelRatio)
  if (canvas.width !== buffer.width) {
    canvas.width = buffer.width
  }
  if (canvas.height !== buffer.height) {
    canvas.height = buffer.height
  }
  context.setTransform(buffer.dpr, 0, 0, buffer.dpr, 0, 0)
  context.clearRect(0, 0, viewport.width, viewport.height)
  if (frames.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return
  }
  const gradient = context.createLinearGradient(0, 0, viewport.width, viewport.height)
  gradient.addColorStop(0, theme.blue)
  gradient.addColorStop(0.5, theme.cyan)
  gradient.addColorStop(1, theme.mint)
  for (const frame of frames) {
    const scene = buildPixelAssemblyScene(frame)
    context.fillStyle = gradient
    for (const pixel of [...scene.rim, ...scene.particles]) {
      context.globalAlpha = pixel.alpha
      context.fillRect(pixel.x, pixel.y, pixel.size, pixel.size)
    }
  }
  context.globalAlpha = 1
}
