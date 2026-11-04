import React from 'react'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNodeFrameResize } from '@contexts/workspace/presentation/renderer/utils/nodeFrameResize'
import { useTerminalViewportState } from '@contexts/workspace/presentation/renderer/components/terminalNode/useTerminalViewportState'
import { useWebsiteNodeFrameConstraints } from '@contexts/workspace/presentation/renderer/components/WebsiteNode.frame'
import { useWebsiteNodeNativeView } from '@contexts/workspace/presentation/renderer/components/WebsiteNode.nativeView'
import {
  setTerminalViewportInteractionActive,
  setTerminalViewportZoom,
} from '@contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'
import { setTerminalRasterViewportZoom } from '@contexts/workspace/presentation/renderer/components/terminalNode/terminalRasterScaleController'
import { VIEWPORT_INTERACTION_SETTLE_MS } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'

vi.mock(
  '@contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio',
  () => ({
    setTerminalViewportInteractionActive: vi.fn(),
    setTerminalViewportZoom: vi.fn(),
  }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/terminalNode/terminalRasterScaleController',
  () => ({ setTerminalRasterViewportZoom: vi.fn() }),
)
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
)
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('viewport projection without window renders', () => {
  it('reads current zoom and website size constraints when resizing, without subscribing the window', () => {
    const onResize = vi.fn()
    let renders = 0
    const { result, unmount } = renderHook(
      () => {
        renders += 1
        const store = useStoreApi()
        const resize = useNodeFrameResize({
          position: { x: 0, y: 0 },
          width: 200,
          height: 120,
          minSize: { width: 100, height: 100 },
          getMaxSize: () => ({ width: 280, height: 200 }),
          onResize,
        })
        return { store, resize }
      },
      { wrapper },
    )
    act(() => result.current.store.setState({ transform: [40, 60, 0.5] }))
    expect(renders).toBe(1)
    const handle = document.createElement('div')
    handle.setPointerCapture = vi.fn()
    const down = result.current.resize.handleResizePointerDown({ right: true })
    act(() =>
      down({
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        currentTarget: handle,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as never),
    )
    // 50 screen pixels = 100 flow pixels at 50%, capped to the current website constraint.
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 })
    expect(result.current.resize.draftFrame?.size.width).toBe(280)
    fireEvent.pointerUp(window)
    expect(onResize).toHaveBeenLastCalledWith(
      expect.objectContaining({ size: { width: 280, height: 120 } }),
    )
    unmount()
  })

  it('updates terminal zoom, raster scale and settled output scheduling without rendering, and cleans up', () => {
    vi.useFakeTimers()
    const terminalRef = { current: { buffer: { active: { baseY: 0, viewportY: 0 } } } as never }
    const onViewportInteractionActiveChange = vi.fn()
    const outputSchedulerRef = { current: { onViewportInteractionActiveChange } as never }
    let renders = 0
    const { result, unmount } = renderHook(
      () => {
        renders += 1
        return {
          store: useStoreApi(),
          viewport: useTerminalViewportState({ terminalRef, outputSchedulerRef }),
        }
      },
      { wrapper },
    )
    const interaction = (active: boolean) =>
      act(() => result.current.store.setState({ coveViewportInteractionActive: active } as never))
    interaction(true)
    for (const zoom of [0.8, 0.4, 0.2, 0.7]) {
      act(() => result.current.store.setState({ transform: [0, 0, zoom] }))
    }
    expect(renders).toBe(1)
    expect(result.current.viewport.viewportZoomRef.current).toBe(0.7)
    expect(setTerminalViewportZoom).toHaveBeenLastCalledWith(terminalRef.current, 0.7)
    expect(setTerminalRasterViewportZoom).toHaveBeenLastCalledWith(terminalRef.current, 0.7)
    interaction(false)
    act(() => vi.advanceTimersByTime(VIEWPORT_INTERACTION_SETTLE_MS - 1))
    expect(result.current.viewport.isViewportInteractionActiveRef.current).toBe(true)
    interaction(true)
    act(() => vi.advanceTimersByTime(VIEWPORT_INTERACTION_SETTLE_MS))
    expect(onViewportInteractionActiveChange).toHaveBeenLastCalledWith(true)
    interaction(false)
    act(() => vi.advanceTimersByTime(VIEWPORT_INTERACTION_SETTLE_MS))
    expect(setTerminalViewportInteractionActive).toHaveBeenLastCalledWith(
      terminalRef.current,
      false,
    )
    expect(onViewportInteractionActiveChange).toHaveBeenLastCalledWith(false)
    interaction(true)
    interaction(false)
    unmount()
    const calls = onViewportInteractionActiveChange.mock.calls.length
    act(() => {
      result.current.store.setState({ transform: [0, 0, 1] })
      vi.runAllTimers()
    })
    expect(onViewportInteractionActiveChange).toHaveBeenCalledTimes(calls)
    expect(setTerminalViewportZoom).toHaveBeenLastCalledWith(terminalRef.current, 0.7)
  })

  it('applies the initial projection after a terminal attaches during an active gesture', async () => {
    const terminalRef: { current: null | never } = { current: null }
    const outputSchedulerRef = { current: { onViewportInteractionActiveChange: vi.fn() } as never }
    const { result, unmount } = renderHook(
      () => {
        const store = useStoreApi()
        const viewport = useTerminalViewportState({ terminalRef, outputSchedulerRef })
        return { store, viewport }
      },
      { wrapper },
    )
    act(() =>
      result.current.store.setState({
        transform: [0, 0, 0.4],
        coveViewportInteractionActive: true,
      } as never),
    )
    const terminal = { buffer: { active: { baseY: 0, viewportY: 0 } } } as never
    await act(async () => {
      terminalRef.current = terminal
    })
    expect(setTerminalViewportZoom).toHaveBeenLastCalledWith(terminal, 0.4)
    expect(setTerminalViewportInteractionActive).toHaveBeenLastCalledWith(terminal, true)
    unmount()
  })

  it('reads fullscreen and maximum website geometry from the current viewport without rendering on pan/zoom', () => {
    const onResize = vi.fn()
    const onFullscreenChange = vi.fn()
    const viewportRef = { current: document.createElement('div') }
    let renders = 0
    const { result, unmount } = renderHook(
      () => {
        renders += 1
        return {
          store: useStoreApi(),
          frame: useWebsiteNodeFrameConstraints({
            viewportRef,
            position: { x: 0, y: 0 },
            width: 200,
            height: 120,
            isFullscreen: false,
            previousFrame: null,
            onResize,
            onFullscreenChange,
          }),
        }
      },
      { wrapper },
    )
    act(() => result.current.store.setState({ transform: [40, 60, 0.5] }))
    expect(renders).toBe(1)
    expect(onResize).not.toHaveBeenCalled()
    expect(result.current.frame.getMaxNodeSize()).toEqual({
      width: Math.floor(window.innerWidth * 1.8),
      height: Math.floor(window.innerHeight * 1.8),
    })
    act(() => result.current.frame.toggleFullscreen())
    expect(onFullscreenChange).toHaveBeenLastCalledWith(
      {
        position: { x: -80, y: -120 },
        size: { width: window.innerWidth * 2, height: window.innerHeight * 2 },
      },
      expect.anything(),
      true,
    )
    unmount()
    act(() => result.current.store.setState({ transform: [0, 0, 10] }))
    expect(onResize).not.toHaveBeenCalled()
  })

  it('tracks native bounds on pan frames and freezes only once per continuous zoom, with hysteresis and timer cleanup', () => {
    vi.useFakeTimers()
    const setBounds = vi.fn()
    const captureSnapshot = vi.fn()
    window.opencoveApi = { websiteWindow: { setBounds, captureSnapshot } } as never
    let frame: FrameRequestCallback = () => {}
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frame = callback
      return 1
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const viewportRef = { current: document.createElement('div') }
    let left = 10
    vi.spyOn(viewportRef.current, 'getBoundingClientRect').mockImplementation(() => ({
      x: left,
      left,
      top: 10,
      y: 10,
      width: 200,
      height: 120,
      right: left + 200,
      bottom: 130,
      toJSON: () => ({}),
    }))
    let renders = 0
    const { result, unmount } = renderHook(
      () => {
        renders += 1
        return {
          store: useStoreApi(),
          native: useWebsiteNodeNativeView({
            nodeId: 'browser',
            desiredUrl: 'http://localhost',
            pinned: false,
            sessionMode: 'shared',
            profileId: null,
            enabled: true,
            lifecycle: 'active',
            isOccluded: false,
            viewportRef,
          }),
        }
      },
      { wrapper },
    )
    left = 30
    act(() => {
      result.current.store.setState({ transform: [20, 0, 1] })
      frame(0)
    })
    expect(renders).toBe(1)
    expect(setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ bounds: { x: 30, y: 10, width: 200, height: 120 }, canvasZoom: 1 }),
    )
    for (const zoom of [0.9, 0.8, 0.7, 0.6]) {
      act(() => result.current.store.setState({ transform: [20, 0, zoom] }))
    }
    expect(renders).toBe(2)
    expect(result.current.native.isCanvasZoomFrozen).toBe(true)
    expect(captureSnapshot).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(260))
    expect(renders).toBe(3)
    expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ canvasZoom: 0.6 }))
    act(() => result.current.store.setState({ transform: [20, 0, 0.6944444444444445] }))
    act(() => vi.advanceTimersByTime(260))
    expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ canvasZoom: 0.694 }))
    act(() => result.current.store.setState({ transform: [0, 0, 0.2] }))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.native.isCanvasZoomFrozen).toBe(true)
    act(() => result.current.store.setState({ transform: [0, 0, 0.27] }))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.native.isCanvasZoomFrozen).toBe(true)
    act(() => result.current.store.setState({ transform: [0, 0, 0.3] }))
    act(() => vi.advanceTimersByTime(260))
    expect(result.current.native.isCanvasZoomFrozen).toBe(false)
    act(() => result.current.store.setState({ transform: [0, 0, 0.4] }))
    unmount()
    const calls = setBounds.mock.calls.length
    act(() => {
      vi.runAllTimers()
      result.current.store.setState({ transform: [0, 0, 1] })
    })
    expect(setBounds).toHaveBeenCalledTimes(calls)
    expect(cancel).toHaveBeenCalled()
  })
})
