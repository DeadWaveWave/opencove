import type { PixelAssemblyBand } from './assembly'
import type { PixelRect } from './geometry'
import { pixelNoise } from './model'

export interface PixelCreationRimPoint {
  x: number
  y: number
  size: number
  alpha: number
}

/** A rectangular creation rim follows only the revealed area; it is unrelated to PTY activity. */
export function buildPixelCreationRim(
  rect: PixelRect,
  frontier: readonly PixelAssemblyBand[],
  intensity: number,
  seed: number,
): PixelCreationRimPoint[] {
  const pixels: PixelCreationRimPoint[] = []
  if (intensity <= 0 || rect.width <= 0 || rect.height <= 0 || frontier.length === 0) {
    return pixels
  }
  const add = (x: number, y: number) => {
    const noise = pixelNoise(pixels.length, seed)
    pixels.push({ x, y, size: 1.4 + noise * 1.4, alpha: intensity * (0.25 + noise * 0.35) })
  }
  const horizontal = (reveal: number, y: number) => {
    if (reveal <= 0) {
      return
    }
    const width = rect.width * reveal
    const count = Math.max(2, Math.min(48, Math.ceil(width / 12)))
    for (let index = 0; index < count; index++) {
      add(rect.x + ((index + 0.5) / count) * width, y)
    }
  }
  horizontal(frontier[0].reveal, rect.y - 4)
  horizontal(frontier[frontier.length - 1].reveal, rect.y + rect.height + 2)
  const rows = Math.max(2, Math.min(64, Math.ceil(rect.height / 12)))
  for (let index = 0; index < rows; index++) {
    const position = (index + 0.5) / rows
    const band =
      frontier.find(part => position < part.top + part.height) ?? frontier[frontier.length - 1]
    if (band.reveal <= 0) {
      continue
    }
    const y = rect.y + position * rect.height
    add(rect.x - 4, y)
    add(rect.x + rect.width * band.reveal + 2, y)
  }
  return pixels
}
