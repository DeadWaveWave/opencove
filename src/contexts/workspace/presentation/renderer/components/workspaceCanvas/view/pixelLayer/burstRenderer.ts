import { buildPixelBurstScene, type PixelBurstFrame } from './burst'
import type { PixelAssemblyTheme } from './assemblyRenderer'
import type { PixelViewport } from './geometry'

/** Composites onto the assembly owner's prepared foreground buffer; never clears or resizes it. */
export function drawPixelBursts({
  context,
  viewport,
  frames,
  theme,
}: {
  context: CanvasRenderingContext2D
  viewport: PixelViewport
  frames: PixelBurstFrame[]
  theme: PixelAssemblyTheme
}): void {
  if (!frames.length || viewport.width <= 0 || viewport.height <= 0) {
    return
  }
  const previousAlpha = context.globalAlpha
  const previousFill = context.fillStyle
  try {
    for (const frame of frames) {
      const scene = buildPixelBurstScene(frame)
      const gradient = context.createLinearGradient(
        frame.rect.x,
        frame.rect.y,
        frame.rect.x + frame.rect.width,
        frame.rect.y + frame.rect.height,
      )
      gradient.addColorStop(0, theme.blue)
      gradient.addColorStop(0.5, theme.cyan)
      gradient.addColorStop(1, theme.mint)
      context.fillStyle = gradient
      for (const pixel of scene.particles) {
        context.globalAlpha = pixel.alpha
        context.fillRect(pixel.x - pixel.size / 2, pixel.y - pixel.size / 2, pixel.size, pixel.size)
      }
    }
  } finally {
    context.globalAlpha = previousAlpha
    context.fillStyle = previousFill
  }
}
