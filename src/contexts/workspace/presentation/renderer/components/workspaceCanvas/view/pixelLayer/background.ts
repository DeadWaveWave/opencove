import { createPixelFieldColumn, resolvePixelScanFront } from './field'
import { resolvePixelGrid } from './grid'
import { pixelNoise, type PixelViewport } from './model'

const MAX_BACKGROUND_PIXELS = 6000

export function drawPixelBackground(
  context: CanvasRenderingContext2D,
  viewport: PixelViewport,
  gap: number,
  opacity: number,
  now: number,
  reducedMotion: boolean,
): void {
  const layout = resolvePixelGrid(viewport, gap)
  const retention = 0.34 + layout.detail * 0.26
  let painted = 0
  for (const layer of layout.layers) {
    if (layer.weight === 0) {
      continue
    }
    const seed = layer.level * 92821
    for (let column = layer.firstColumn; column < layer.firstColumn + layer.columns; column++) {
      // Stable sub-cell offsets and sparse occupancy break the two lattices' interference.
      const x = (column + (pixelNoise(column, seed) - 0.5) * 0.3) * layer.gap + viewport.x
      const sample = createPixelFieldColumn(x, viewport.height, now, reducedMotion, layout.detail)
      for (let row = layer.firstRow; row < layer.firstRow + layer.rows; row++) {
        const presence = pixelNoise(column + seed, row)
        if (presence > retention || painted >= MAX_BACKGROUND_PIXELS) {
          continue
        }
        const y = (row + (pixelNoise(seed, row) - 0.5) * 0.3) * layer.gap + viewport.y
        const noise = pixelNoise(column + seed, row + 7129)
        const cell = sample(y, noise)
        // Fade occupancy near its threshold so far-zoom thinning cannot pop random pixels.
        const coverage = Math.min(1, (retention - presence) / 0.1)
        context.globalAlpha = opacity * layer.opacity * cell.alpha * coverage
        context.fillRect(x - cell.size / 2, y - cell.size / 2, cell.size, cell.size)
        painted++
      }
    }
  }
  if (!reducedMotion && layout.detail > 0) {
    // Decoration has screen-space lanes, independent of the world-grid LOD and pan phase.
    for (let lane = 0; lane < 3; lane++) {
      for (let row = 0; row * 28 < viewport.height && painted < MAX_BACKGROUND_PIXELS; row++) {
        const noise = pixelNoise(row, lane)
        if (noise < 0.58) {
          continue
        }
        const y = row * 28 + 12
        const front = resolvePixelScanFront(lane, y, viewport.width, now, noise, layout.detail)
        context.globalAlpha = opacity * front.alpha
        context.fillRect(front.x - front.size / 2, y - front.size / 2, front.size, front.size)
        painted++
      }
    }
  }
}
