import { describe, expect, it } from 'vitest'
import {
  resolvePixelDetail,
  resolvePixelGrid,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/grid'

const viewport = { x: -123.5, y: 87.25, zoom: 1, width: 1120, height: 640 }

describe('continuous Pixel background detail', () => {
  it.each([1, 0.5, 0.2, 0.08])('keeps the dominant grid at screen scale at zoom %s', zoom => {
    const layout = resolvePixelGrid({ ...viewport, zoom }, 17)
    const dominant = [...layout.layers].sort((a, b) => b.weight - a.weight)[0]!
    expect(dominant.gap).toBeGreaterThanOrEqual(14)
    expect(dominant.gap).toBeLessThanOrEqual(24)
    expect(layout.layers.reduce((sum, layer) => sum + layer.weight, 0)).toBeCloseTo(1)
    expect(layout.layers.reduce((sum, layer) => sum + layer.columns * layer.rows, 0)).toBeLessThan(
      9000,
    )
    expect(layout.layers.every(layer => layer.gap === layer.worldGap * zoom)).toBe(true)
  })

  it('preserves world anchors and level identities while panning', () => {
    const first = resolvePixelGrid(viewport, 17)
    const moved = resolvePixelGrid({ ...viewport, x: viewport.x + 11, y: viewport.y - 7 }, 17)
    for (const layer of first.layers) {
      const same = moved.layers.find(next => next.level === layer.level)!
      expect(same.worldGap).toBe(layer.worldGap)
      expect(same.weight).toBe(layer.weight)
      expect(12 * same.gap + viewport.x + 11 - (12 * layer.gap + viewport.x)).toBeCloseTo(11)
    }
  })

  it('crossfades into the identical world lattice without a reseed at level boundaries', () => {
    // Above working zoom detail is constant, making every sqrt(2) boundary explicit.
    for (const boundary of [1, Math.SQRT2, 2, 2 * Math.SQRT2]) {
      const before = resolvePixelGrid({ ...viewport, zoom: boundary - 1e-7 }, 17)
      const after = resolvePixelGrid({ ...viewport, zoom: boundary + 1e-7 }, 17)
      const dominantBefore = [...before.layers].sort((a, b) => b.weight - a.weight)[0]!
      const dominantAfter = [...after.layers].sort((a, b) => b.weight - a.weight)[0]!
      expect(dominantAfter.level).toBe(dominantBefore.level)
      expect(dominantAfter.worldGap).toBe(dominantBefore.worldGap)
      expect(Math.abs(dominantAfter.weight - dominantBefore.weight)).toBeLessThan(0.00001)
    }
  })

  it('preserves weighted sample density throughout a crossfade', () => {
    for (const zoom of [0.08, 0.2, 0.49, 0.5, 0.51, 0.73, 1]) {
      const { layers, targetGap } = resolvePixelGrid({ ...viewport, zoom }, 17)
      const density = layers.reduce((sum, layer) => sum + layer.opacity / layer.gap ** 2, 0)
      expect(density).toBeCloseTo(1 / targetGap ** 2, 12)
    }
  })

  it('bounds candidate cost for large and narrow viewports and drops far-zoom detail', () => {
    for (const [width, height] of [
      [8000, 5000],
      [40, 100000],
      [100000, 40],
    ]) {
      const layout = resolvePixelGrid({ ...viewport, zoom: 0.08, width, height }, 17)
      expect(
        layout.layers.reduce((sum, layer) => sum + layer.columns * layer.rows, 0),
      ).toBeLessThan(9000)
    }
    expect(resolvePixelDetail(1)).toBe(1)
    expect(resolvePixelDetail(0.2)).toBeLessThan(0.05)
    expect(resolvePixelDetail(0.08)).toBe(0)
    expect(resolvePixelGrid({ ...viewport, zoom: 0 }, 17).layers).toEqual([])
  })
})
