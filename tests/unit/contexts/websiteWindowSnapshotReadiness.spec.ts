import { EventEmitter } from 'node:events'
import type { BrowserWindow, NativeImage } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ensureWebsiteWindowRuntime } from '../../../src/app/main/websiteWindow/websiteWindowRuntimeFactory'
import {
  applyWebsiteWindowBounds,
  requestWebsiteWindowRuntimeSnapshot,
} from '../../../src/app/main/websiteWindow/websiteWindowRuntimeViewOps'
import { transitionWebsiteWindowToWarm } from '../../../src/app/main/websiteWindow/websiteWindowLifecycle'

function createFixture() {
  let presentFrame: (image: NativeImage) => void = () => {}
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => destroyed),
    // Electron can finish loading before its display surface supports capturePage.
    capturePage: vi.fn().mockRejectedValue(new Error('UnknownVizError')),
    beginFrameSubscription: vi.fn((_onlyDirty: boolean, callback: typeof presentFrame) => {
      presentFrame = callback
    }),
    endFrameSubscription: vi.fn(),
  })
  const runtime = ensureWebsiteWindowRuntime({
    runtimeByNodeId: new Map(),
    nodeId: 'website-node',
    desiredUrl: 'https://example.com',
    pinned: false,
    sessionMode: 'shared',
    profileId: null,
  })
  Object.assign(runtime, {
    lifecycle: 'active',
    snapshotDocumentReady: true,
    url: 'https://example.com',
    bounds: { x: 0, y: 0, width: 480, height: 320 },
    view: { webContents: contents },
  })
  const emit = vi.fn()
  const toJPEG = vi.fn(() => Buffer.from('snapshot'))
  const image = { isEmpty: () => false, toJPEG } as unknown as NativeImage
  return {
    runtime,
    contents,
    emit,
    image,
    toJPEG,
    presentFrame: (frame = image) => presentFrame(frame),
    destroy: () => {
      destroyed = true
      contents.emit('destroyed')
    },
    request: (quality = 60) => requestWebsiteWindowRuntimeSnapshot({ runtime, quality, emit }),
  }
}

describe('website snapshot presentation readiness', () => {
  it('fulfills a loaded document request when its first capturable frame arrives', async () => {
    const fixture = createFixture()
    fixture.request()
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.runtime.snapshotDataUrl).toBeNull()
    expect(fixture.runtime.pendingSnapshotQuality).toBe(60)
    fixture.presentFrame()

    expect(fixture.runtime.snapshotDataUrl).toBe('data:image/jpeg;base64,c25hcHNob3Q=')
    expect(fixture.runtime.pendingSnapshotQuality).toBeNull()
    expect(fixture.emit).toHaveBeenCalledWith({
      type: 'snapshot',
      nodeId: 'website-node',
      dataUrl: fixture.runtime.snapshotDataUrl,
    })
    expect(fixture.contents.endFrameSubscription).toHaveBeenCalledOnce()
    expect(fixture.contents.capturePage).not.toHaveBeenCalled()
    expect(fixture.runtime.snapshotCaptureInFlight).toBe(false)
    expect(fixture.runtime.disposeSnapshotCapture).toBeNull()
    expect(fixture.contents.listenerCount('destroyed')).toBe(0)
  })

  it('coalesces requests while waiting for a frame and uses the latest quality', () => {
    const fixture = createFixture()
    fixture.request(60)
    fixture.request(75)
    fixture.request(75)
    expect(fixture.contents.beginFrameSubscription).toHaveBeenCalledOnce()

    fixture.presentFrame()
    fixture.presentFrame()
    expect(fixture.toJPEG).toHaveBeenCalledExactlyOnceWith(75)
    expect(fixture.emit).toHaveBeenCalledOnce()
  })

  it('keeps the request pending across empty presentation frames', () => {
    const fixture = createFixture()
    fixture.request()
    fixture.presentFrame({ isEmpty: () => true } as NativeImage)
    expect(fixture.runtime.pendingSnapshotQuality).toBe(60)
    expect(fixture.emit).not.toHaveBeenCalled()
    expect(fixture.contents.endFrameSubscription).not.toHaveBeenCalled()

    fixture.presentFrame()
    expect(fixture.emit).toHaveBeenCalledOnce()
  })

  it('ignores queued frames after cancellation and allows the pending request to resume', () => {
    const fixture = createFixture()
    fixture.request()
    fixture.runtime.disposeSnapshotCapture?.()
    fixture.presentFrame()
    expect(fixture.runtime.snapshotDataUrl).toBeNull()
    expect(fixture.runtime.pendingSnapshotQuality).toBe(60)
    expect(fixture.contents.endFrameSubscription).toHaveBeenCalledOnce()

    fixture.request()
    fixture.presentFrame()
    expect(fixture.emit).toHaveBeenCalledOnce()
    expect(fixture.contents.beginFrameSubscription).toHaveBeenCalledTimes(2)
  })

  it('releases in-flight state when the native contents is destroyed', () => {
    const fixture = createFixture()
    fixture.request()
    fixture.destroy()
    fixture.presentFrame()
    expect(fixture.runtime.snapshotCaptureInFlight).toBe(false)
    expect(fixture.runtime.disposeSnapshotCapture).toBeNull()
    expect(fixture.contents.endFrameSubscription).not.toHaveBeenCalled()
    expect(fixture.emit).not.toHaveBeenCalled()
  })

  it('does not publish a frame from a replaced view', () => {
    const fixture = createFixture()
    fixture.request()
    fixture.runtime.view = null
    fixture.presentFrame()
    expect(fixture.runtime.snapshotDataUrl).toBeNull()
    expect(fixture.runtime.pendingSnapshotQuality).toBe(60)
    expect(fixture.contents.endFrameSubscription).toHaveBeenCalledOnce()
  })

  it('finishes a capture requested just before canvas zoom hides the view', () => {
    const fixture = createFixture()
    fixture.runtime.hostView = { setVisible: vi.fn() } as unknown as NonNullable<
      typeof fixture.runtime.hostView
    >
    fixture.request()
    fixture.runtime.bounds = { x: 0, y: 0, width: 0, height: 0 }
    fixture.runtime.viewportBounds = fixture.runtime.bounds
    applyWebsiteWindowBounds(fixture.runtime, { x: 0, y: 0, width: 0, height: 0 })
    fixture.presentFrame()
    expect(fixture.contents.endFrameSubscription).toHaveBeenCalledOnce()
    expect(fixture.emit).toHaveBeenCalledOnce()
    expect(fixture.runtime.pendingSnapshotQuality).toBeNull()
  })

  it('releases the subscription when the website is deactivated', () => {
    const fixture = createFixture()
    fixture.runtime.pinned = true
    fixture.request()
    transitionWebsiteWindowToWarm({
      runtime: fixture.runtime,
      window: {
        isDestroyed: () => false,
        contentView: { removeChildView: vi.fn() },
      } as unknown as BrowserWindow,
      policy: { enabled: true, maxActiveCount: 1, discardAfterMinutes: 20, keepAliveHosts: [] },
      emit: fixture.emit,
      emitState: vi.fn(),
    })
    fixture.presentFrame()
    expect(fixture.runtime.lifecycle).toBe('warm')
    expect(fixture.contents.endFrameSubscription).toHaveBeenCalledOnce()
    expect(fixture.runtime.disposeSnapshotCapture).toBeNull()
    expect(fixture.emit).not.toHaveBeenCalled()
  })
})
