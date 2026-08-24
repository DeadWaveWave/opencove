import { WebglAddon } from '@xterm/addon-webgl'
import { describe, expect, it, vi } from 'vitest'
import { terminalRasterScaleLevels } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalZoomRasterPolicy'
import { MAX_CANVAS_ZOOM } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'

type RasterScaleTestAddon = WebglAddon & {
  _rasterScale?: number
  _renderer?: { setRasterScale: (scale: number) => void }
}

describe('patched WebglAddon raster scale contract', () => {
  it('covers the canvas zoom range without exceeding the addon clamp', () => {
    const policyCeiling = Math.max(...terminalRasterScaleLevels)
    expect(policyCeiling).toBeGreaterThanOrEqual(MAX_CANVAS_ZOOM)

    const addon = new WebglAddon() as RasterScaleTestAddon
    const setRasterScale = vi.fn()
    addon._renderer = { setRasterScale }
    addon.setRasterScale(Number.MAX_SAFE_INTEGER)
    const patchedAddonCeiling = setRasterScale.mock.calls[0]?.[0]

    expect(patchedAddonCeiling).toBeTypeOf('number')
    expect(policyCeiling).toBeLessThanOrEqual(patchedAddonCeiling ?? 0)
  })

  it('rejects and preserves an unapplied scale while the renderer is absent', () => {
    const addon = new WebglAddon() as RasterScaleTestAddon

    expect(addon.setRasterScale(1.25)).toBe(false)
    expect(addon._rasterScale ?? 1).toBe(1)
  })

  it('publishes a scale only after the live renderer applies it', () => {
    const addon = new WebglAddon() as RasterScaleTestAddon
    const setRasterScale = vi.fn()
    addon._renderer = { setRasterScale }

    expect(addon.setRasterScale(1.25)).toBe(true)
    expect(setRasterScale).toHaveBeenCalledWith(1.25)
    expect(addon._rasterScale).toBe(1.25)
  })
})
