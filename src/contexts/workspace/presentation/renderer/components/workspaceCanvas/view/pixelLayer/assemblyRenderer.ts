import { buildPixelAssemblyScene, type PixelAssemblyFrame } from './assembly'
import type { PixelViewport } from './geometry'
import { resolvePixelBuffer } from './model'
import { readPixelTheme, type PixelKindTheme } from './renderer'

export type PixelAssemblyTheme = PixelKindTheme

export function readPixelAssemblyTheme(canvas: HTMLCanvasElement): PixelAssemblyTheme {
  const { ink, solid } = readPixelTheme(canvas)
  return { ink, solid }
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
  for (const frame of frames) {
    const scene = buildPixelAssemblyScene(frame)
    context.fillStyle = theme.ink[frame.family]
    for (const pixel of [...scene.rim, ...scene.particles]) {
      context.globalAlpha = pixel.alpha
      context.fillRect(pixel.x, pixel.y, pixel.size, pixel.size)
    }
  }
  context.globalAlpha = 1
}
