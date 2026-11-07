import { buildPixelBurstScene, type PixelBurstFrame } from './burst'
import type { PixelAssemblyTheme } from './assemblyRenderer'
import type { PixelViewport } from './geometry'
import { pixelNoise } from './model'

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
      // Tide shatter mixes solid/ink 50/50; scene indices keep each fragment stable across frames.
      for (const [index, pixel] of scene.particles.entries()) {
        context.fillStyle =
          pixelNoise(index, 0) < 0.5 ? theme.solid[frame.family] : theme.ink[frame.family]
        context.globalAlpha = pixel.alpha
        context.fillRect(pixel.x - pixel.size / 2, pixel.y - pixel.size / 2, pixel.size, pixel.size)
      }
    }
  } finally {
    context.globalAlpha = previousAlpha
    context.fillStyle = previousFill
  }
}
