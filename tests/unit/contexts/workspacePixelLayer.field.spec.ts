import { describe, expect, it } from 'vitest'
import {
  createPixelFieldColumn,
  resolvePixelScanFront,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/field'

describe('Pixel wave field', () => {
  it('changes its wave shape with continuous time and keeps a stable sample at the same time', () => {
    const first = createPixelFieldColumn(340, 640, 0, false)
    const later = createPixelFieldColumn(340, 640, 1800, false)
    expect(first(340, 0.75)).toEqual(createPixelFieldColumn(340, 640, 0, false)(340, 0.75))
    const changes = [200, 250, 300, 350, 400, 450, 500, 550].map(y => ({
      size: Math.abs(first(y, 0.75).size - later(y, 0.75).size),
      alpha: Math.abs(first(y, 0.75).alpha - later(y, 0.75).alpha),
    }))
    expect(Math.max(...changes.map(change => change.size))).toBeGreaterThan(0.3)
    expect(Math.max(...changes.map(change => change.alpha))).toBeGreaterThan(0.05)
  })

  it('freezes motion while preserving the spatial difference between trough and ridge', () => {
    const first = createPixelFieldColumn(0, 640, 0, true)
    const later = createPixelFieldColumn(0, 640, 9000, true)
    expect(first(309, 0.8)).toEqual(later(309, 0.8))
    expect(first(309, 0.8).size).toBeGreaterThan(first(20, 0.8).size + 3)
    expect(first(309, 0.8).alpha).toBeGreaterThan(first(20, 0.8).alpha + 0.2)
  })

  it('bounds pixel sizes and brightness over a complete moving wave cycle', () => {
    for (let time = 0; time < 24000; time += 4000) {
      for (let x = -17; x < 1140; x += 170) {
        const sample = createPixelFieldColumn(x, 640, time, false)
        for (let y = -17; y < 660; y += 85) {
          for (const noise of [0, 0.5, 1]) {
            const cell = sample(y, noise)
            expect(cell.size).toBeGreaterThanOrEqual(2)
            expect(cell.size).toBeLessThanOrEqual(7)
            expect(cell.alpha).toBeGreaterThanOrEqual(0.075)
            expect(cell.alpha).toBeLessThanOrEqual(0.9)
          }
        }
      }
    }
  })

  it('transports scan fronts at 33 pixels per second with stable pixel texture', () => {
    const first = resolvePixelScanFront(1, 240, 1120, 0, 0.7)
    const later = resolvePixelScanFront(1, 240, 1120, 1000, 0.7)
    expect(later.x - first.x).toBeCloseTo(33)
    expect(later.size).toBe(first.size)
    expect(later.alpha).toBe(first.alpha)
  })
})
