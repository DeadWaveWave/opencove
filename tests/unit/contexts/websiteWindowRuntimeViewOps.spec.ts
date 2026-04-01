import { describe, expect, it, vi } from 'vitest'
import { applyWebsiteWindowViewportMetrics } from '../../../src/app/main/websiteWindow/websiteWindowRuntimeViewOps'

describe('websiteWindowRuntimeViewOps', () => {
  it('scales the native view corner radius to match the canvas zoom', () => {
    const setBounds = vi.fn()
    const setVisible = vi.fn()
    const setBorderRadius = vi.fn()
    const setZoomFactor = vi.fn()

    const view = {
      setBounds,
      setVisible,
      setBorderRadius,
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1),
        setZoomFactor,
      },
    }

    applyWebsiteWindowViewportMetrics({
      runtime: { view } as unknown as Parameters<
        typeof applyWebsiteWindowViewportMetrics
      >[0]['runtime'],
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      canvasZoom: 0.5,
    })

    expect(setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(setBorderRadius).toHaveBeenCalledWith(7)
    expect(setVisible).toHaveBeenCalledWith(true)
    expect(setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 })
  })

  it('syncs website page zoom to the canvas zoom', () => {
    const setBounds = vi.fn()
    const setVisible = vi.fn()
    const setBorderRadius = vi.fn()
    const setZoomFactor = vi.fn()

    const view = {
      setBounds,
      setVisible,
      setBorderRadius,
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1.25),
        setZoomFactor,
      },
    }

    applyWebsiteWindowViewportMetrics({
      runtime: { view } as unknown as Parameters<
        typeof applyWebsiteWindowViewportMetrics
      >[0]['runtime'],
      bounds: { x: 0, y: 0, width: 200, height: 150 },
      canvasZoom: 1,
    })

    expect(setZoomFactor).toHaveBeenCalledWith(1)
  })
})
