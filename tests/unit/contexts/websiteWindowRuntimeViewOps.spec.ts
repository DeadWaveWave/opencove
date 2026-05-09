import { describe, expect, it, vi } from 'vitest'
import {
  applyWebsiteWindowViewportMetrics,
  flushPendingWebsiteWindowRuntimeSnapshot,
  requestWebsiteWindowRuntimeSnapshot,
} from '../../../src/app/main/websiteWindow/websiteWindowRuntimeViewOps'

describe('websiteWindowRuntimeViewOps', () => {
  it('scales the native view corner radius to match the canvas zoom', () => {
    const hostSetBounds = vi.fn()
    const hostSetVisible = vi.fn()
    const viewSetBounds = vi.fn()
    const viewSetVisible = vi.fn()
    const setBorderRadius = vi.fn()
    const setZoomFactor = vi.fn()

    const view = {
      setBounds: viewSetBounds,
      setVisible: viewSetVisible,
      setBorderRadius,
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1),
        setZoomFactor,
      },
    }

    applyWebsiteWindowViewportMetrics({
      runtime: {
        hostView: { setBounds: hostSetBounds, setVisible: hostSetVisible },
        view,
      } as unknown as Parameters<typeof applyWebsiteWindowViewportMetrics>[0]['runtime'],
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      viewportBounds: { x: 10, y: 20, width: 300, height: 200 },
      canvasZoom: 0.5,
    })

    expect(setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(setBorderRadius).toHaveBeenCalledWith(7)
    expect(hostSetVisible).toHaveBeenCalledWith(true)
    expect(hostSetBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 })
    expect(viewSetVisible).toHaveBeenCalledWith(true)
    expect(viewSetBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('syncs website page zoom to the canvas zoom', () => {
    const hostSetBounds = vi.fn()
    const hostSetVisible = vi.fn()
    const viewSetBounds = vi.fn()
    const viewSetVisible = vi.fn()
    const setBorderRadius = vi.fn()
    const setZoomFactor = vi.fn()

    const view = {
      setBounds: viewSetBounds,
      setVisible: viewSetVisible,
      setBorderRadius,
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1.25),
        setZoomFactor,
      },
    }

    applyWebsiteWindowViewportMetrics({
      runtime: {
        hostView: { setBounds: hostSetBounds, setVisible: hostSetVisible },
        view,
      } as unknown as Parameters<typeof applyWebsiteWindowViewportMetrics>[0]['runtime'],
      bounds: { x: 0, y: 0, width: 200, height: 150 },
      viewportBounds: { x: 0, y: 0, width: 200, height: 150 },
      canvasZoom: 1,
    })

    expect(setZoomFactor).toHaveBeenCalledWith(1)
  })

  it('offsets the view within the clip bounds when clipped', () => {
    const hostSetBounds = vi.fn()
    const hostSetVisible = vi.fn()
    const viewSetBounds = vi.fn()
    const viewSetVisible = vi.fn()
    const setBorderRadius = vi.fn()

    const view = {
      setBounds: viewSetBounds,
      setVisible: viewSetVisible,
      setBorderRadius,
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomFactor: vi.fn(() => 1),
        setZoomFactor: vi.fn(),
      },
    }

    applyWebsiteWindowViewportMetrics({
      runtime: {
        hostView: { setBounds: hostSetBounds, setVisible: hostSetVisible },
        view,
      } as unknown as Parameters<typeof applyWebsiteWindowViewportMetrics>[0]['runtime'],
      bounds: { x: 0, y: 0, width: 240, height: 160 },
      viewportBounds: { x: -60, y: 0, width: 300, height: 160 },
      canvasZoom: 1,
    })

    expect(hostSetBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 240, height: 160 })
    expect(viewSetBounds).toHaveBeenCalledWith({ x: -60, y: 0, width: 300, height: 160 })
  })

  it('keeps snapshot requests pending until the runtime is ready to capture', async () => {
    const emit = vi.fn()
    const capturePage = vi.fn()
    const toJPEG = vi.fn(() => Buffer.from('snapshot'))

    const runtime = {
      nodeId: 'website-node',
      lifecycle: 'active',
      isLoading: true,
      url: null,
      bounds: { x: 0, y: 0, width: 480, height: 320 },
      viewportBounds: { x: 0, y: 0, width: 480, height: 320 },
      pendingSnapshotQuality: null,
      snapshotCaptureInFlight: false,
      snapshotDataUrl: null,
      view: {
        webContents: {
          isDestroyed: vi.fn(() => false),
          capturePage,
        },
      },
    } as Parameters<typeof requestWebsiteWindowRuntimeSnapshot>[0]['runtime']

    requestWebsiteWindowRuntimeSnapshot({
      runtime,
      quality: 60,
      emit,
    })

    expect(capturePage).not.toHaveBeenCalled()
    expect(runtime.pendingSnapshotQuality).toBe(60)

    runtime.isLoading = false
    runtime.url = 'https://example.com'
    capturePage.mockResolvedValue({
      toJPEG,
    })

    expect(
      flushPendingWebsiteWindowRuntimeSnapshot({
        runtime,
        emit,
      }),
    ).toBe(true)

    await Promise.resolve()
    await Promise.resolve()

    expect(capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
    expect(runtime.pendingSnapshotQuality).toBeNull()
    expect(runtime.snapshotDataUrl).toBe('data:image/jpeg;base64,c25hcHNob3Q=')
    expect(emit).toHaveBeenCalledWith({
      type: 'snapshot',
      nodeId: 'website-node',
      dataUrl: 'data:image/jpeg;base64,c25hcHNob3Q=',
    })
  })
})
