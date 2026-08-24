import { describe, expect, it } from 'vitest'
import {
  resolveTerminalRasterScale,
  terminalRasterScaleLevels,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalZoomRasterPolicy'

describe('terminal zoom raster policy', () => {
  it('selects the smallest bounded raster level that covers the canvas zoom', () => {
    expect(terminalRasterScaleLevels).toEqual([1, 1.25, 1.5, 1.75])
    expect(resolveTerminalRasterScale({ canvasZoom: 0.35, currentScale: 1 })).toBe(1)
    expect(resolveTerminalRasterScale({ canvasZoom: 1, currentScale: 1 })).toBe(1)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.06, currentScale: 1 })).toBe(1.25)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.25, currentScale: 1 })).toBe(1.25)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.26, currentScale: 1 })).toBe(1.5)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.6, currentScale: 1 })).toBe(1.75)
    expect(resolveTerminalRasterScale({ canvasZoom: 3, currentScale: 1 })).toBe(1.75)
  })

  it('uses hysteresis when crossing a downgrade boundary', () => {
    expect(resolveTerminalRasterScale({ canvasZoom: 1.49, currentScale: 1.75 })).toBe(1.75)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.44, currentScale: 1.75 })).toBe(1.5)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.24, currentScale: 1.5 })).toBe(1.5)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.19, currentScale: 1.5 })).toBe(1.25)
  })

  it('normalizes invalid inputs without producing an unsafe backing scale', () => {
    expect(resolveTerminalRasterScale({ canvasZoom: Number.NaN, currentScale: 1.5 })).toBe(1)
    expect(
      resolveTerminalRasterScale({ canvasZoom: Number.POSITIVE_INFINITY, currentScale: 1 }),
    ).toBe(1)
    expect(resolveTerminalRasterScale({ canvasZoom: 0, currentScale: 1.5 })).toBe(1)
    expect(resolveTerminalRasterScale({ canvasZoom: -1, currentScale: 1.5 })).toBe(1)
    expect(resolveTerminalRasterScale({ canvasZoom: 1.4, currentScale: 9 })).toBe(1.5)
  })
})
