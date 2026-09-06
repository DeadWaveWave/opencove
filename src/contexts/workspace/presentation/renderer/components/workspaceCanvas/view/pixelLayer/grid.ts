import type { PixelViewport } from './geometry'

const SCALE_RATIO = Math.SQRT2
const CANDIDATE_BUDGET = 8900
const smooth = (value: number) => {
  const bounded = Math.max(0, Math.min(1, value))
  return bounded * bounded * (3 - 2 * bounded)
}

export function resolvePixelDetail(zoom: number): number {
  return smooth((zoom - 0.12) / 0.68)
}

export interface PixelGridLayer {
  level: number
  worldGap: number
  gap: number
  weight: number
  opacity: number
  firstColumn: number
  firstRow: number
  columns: number
  rows: number
}

/** Adjacent world lattices fade through the same level at each boundary.
 * Their projected density is compensated so zoom cannot flash a denser screen. */
export function resolvePixelGrid(viewport: PixelViewport, configuredGap: number) {
  const detail = resolvePixelDetail(viewport.zoom)
  const baseGap = Math.max(16, Math.min(20, Number.isFinite(configuredGap) ? configuredGap : 17))
  if (viewport.zoom <= 0 || !Number.isFinite(viewport.zoom)) {
    return { detail: 0, targetGap: baseGap, layers: [] as PixelGridLayer[] }
  }
  const width = Math.max(0, viewport.width)
  const height = Math.max(0, viewport.height)
  // Include overscan rows in the budget, including exceptionally narrow/tall viewports.
  const edgeCost = 4 * (SCALE_RATIO + 1) * (width + height)
  const areaCost = 3 * width * height
  const available = CANDIDATE_BUDGET - 32
  const budgetGap =
    (edgeCost + Math.sqrt(edgeCost ** 2 + 4 * available * areaCost)) / (2 * available)
  const targetGap = Math.max(baseGap + (1 - detail) * 5, budgetGap)
  const levelPosition = Math.log(targetGap / (baseGap * viewport.zoom)) / Math.log(SCALE_RATIO)
  const firstLevel = Math.floor(levelPosition)
  const mix = smooth(levelPosition - firstLevel)
  const layers = [firstLevel, firstLevel + 1].map((level, index): PixelGridLayer => {
    const worldGap = baseGap * SCALE_RATIO ** level
    const gap = worldGap * viewport.zoom
    const weight = index === 0 ? 1 - mix : mix
    return {
      level,
      worldGap,
      gap,
      weight,
      opacity: weight * (gap / targetGap) ** 2,
      firstColumn: Math.floor(-viewport.x / gap) - 1,
      firstRow: Math.floor(-viewport.y / gap) - 1,
      columns: Math.ceil(width / gap) + 3,
      rows: Math.ceil(height / gap) + 3,
    }
  })
  return { detail, targetGap, layers }
}
