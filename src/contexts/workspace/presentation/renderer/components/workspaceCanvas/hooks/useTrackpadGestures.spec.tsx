import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasInputModalityState } from '../../../utils/inputModality'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasTrackpadGestures } from './useTrackpadGestures'
import { resolveWheelZoomDelta } from './useTrackpadGestures.helpers'
import { TRACKPAD_GESTURE_LOCK_GAP_MS, VIEWPORT_INTERACTION_SETTLE_MS } from '../constants'
import { selectViewportInteractionActive } from '../../terminalNode/reactFlowState'

type WheelHandler = (event: WheelEvent) => void
type Camera = { x: number; y: number; zoom: number }
type FlowStore = ReturnType<typeof useStoreApi<Node<TerminalNodeData>>>

// The gestures read React Flow's camera when an event arrives (#647 S8). The mock `setViewport`
// writes the store as `setViewport(..., { duration: 0 })` does, and a test moves the store under
// the hook, as a navigation animation moves it.
function mountGestures({
  inputMode = 'trackpad',
  wheelBehavior = 'pan',
  modality = 'trackpad',
  withNode = false,
}: {
  inputMode?: 'mouse' | 'trackpad' | 'auto'
  wheelBehavior?: 'pan' | 'zoom'
  modality?: 'mouse' | 'trackpad'
  withNode?: boolean
} = {}) {
  const handlerRef = { current: null as WheelHandler | null }
  const storeRef = { current: null as FlowStore | null }
  const canvasRef = { current: null as HTMLDivElement | null }
  const trackpadGestureLockRef = { current: null }
  const inputModalityStateRef = { current: createCanvasInputModalityState(modality) }
  const setDetectedCanvasInputMode = vi.fn()
  const setIsCanvasWheelGestureCaptureActive = vi.fn()
  const setViewport = vi.fn((viewport: Camera) => {
    storeRef.current?.setState({ transform: [viewport.x, viewport.y, viewport.zoom] })
    return Promise.resolve(true)
  })
  const reactFlow = { setViewport } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
  const onViewportChange = vi.fn()

  function TestHarness(): React.JSX.Element {
    const store = useStoreApi<Node<TerminalNodeData>>()
    const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
      canvasInputModeSetting: inputMode,
      canvasWheelBehaviorSetting: wheelBehavior,
      canvasWheelZoomModifierSetting: 'primary',
      resolvedCanvasInputMode: modality,
      inputModalityStateRef,
      setDetectedCanvasInputMode,
      canvasRef,
      trackpadGestureLockRef,
      setIsCanvasWheelGestureCaptureActive,
      reactFlow,
      onViewportChange,
    })

    useEffect(() => {
      handlerRef.current = handleCanvasWheelCapture
      storeRef.current = store
    }, [handleCanvasWheelCapture, store])

    return (
      <div
        ref={node => {
          canvasRef.current = node
        }}
      >
        {withNode ? (
          <div className="react-flow__node">
            <div data-testid="node-target" />
          </div>
        ) : null}
      </div>
    )
  }

  const rendered = render(
    <ReactFlowProvider>
      <TestHarness />
    </ReactFlowProvider>,
  )

  const canvas = canvasRef.current
  const wheel = handlerRef.current
  const store = storeRef.current
  expect(canvas).not.toBeNull()
  expect(wheel).toBeTypeOf('function')
  expect(store).not.toBeNull()

  return {
    canvas: canvas as HTMLDivElement,
    nodeTarget: withNode ? rendered.getByTestId('node-target') : null,
    store: store as FlowStore,
    setViewport,
    onViewportChange,
    trackpadGestureLockRef,
    setIsCanvasWheelGestureCaptureActive,
    camera: (): Camera => {
      const [x, y, zoom] = (store as FlowStore).getState().transform
      return { x, y, zoom }
    },
    moveCamera: (camera: Camera): void => {
      ;(store as FlowStore).setState({ transform: [camera.x, camera.y, camera.zoom] })
    },
    wheel: (target: Element | null, overrides: Partial<WheelEvent>): void => {
      ;(wheel as WheelHandler)({
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        timeStamp: 100,
        clientX: 0,
        clientY: 0,
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...overrides,
      } as unknown as WheelEvent)
    },
  }
}

function dispatchGesture(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  init: { scale?: number; clientX?: number; clientY?: number; timeStamp?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value, configurable: true })
  }
  target.dispatchEvent(event)
  return event
}

describe('useWorkspaceCanvasTrackpadGestures', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          isTest: true,
          platform: 'darwin',
        },
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits the persisted viewport after wheel panning settles', async () => {
    const mounted = mountGestures()

    mounted.wheel(mounted.canvas, { deltaX: 100 })

    expect(mounted.setViewport).toHaveBeenCalledTimes(1)
    expect(mounted.onViewportChange).toHaveBeenCalledTimes(0)
    expect(mounted.setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(true)

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(mounted.onViewportChange).toHaveBeenCalledTimes(1)
    expect(mounted.onViewportChange).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 })

    await vi.advanceTimersByTimeAsync(100)

    expect(mounted.setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)
  })

  // Until the commit point of PR 2 replaces this timer, it still commits, and it commits the camera
  // React Flow shows when it fires, not the one the last event wrote.
  it('commits the camera React Flow shows when the settle timer fires', async () => {
    const mounted = mountGestures()

    mounted.wheel(mounted.canvas, { deltaX: 100 })
    mounted.moveCamera({ x: 500, y: 7, zoom: 1.5 })

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(mounted.onViewportChange).toHaveBeenCalledTimes(1)
    expect(mounted.onViewportChange).toHaveBeenCalledWith({ x: 500, y: 7, zoom: 1.5 })
  })

  it('commits the camera React Flow shows when a Safari pinch ends', async () => {
    const mounted = mountGestures({ inputMode: 'auto', wheelBehavior: 'zoom', modality: 'mouse' })

    dispatchGesture(mounted.canvas, 'gesturestart', { scale: 1, timeStamp: 100 })
    mounted.moveCamera({ x: 12, y: 34, zoom: 0.5 })
    dispatchGesture(mounted.canvas, 'gestureend')

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(mounted.onViewportChange).toHaveBeenCalledTimes(1)
    expect(mounted.onViewportChange).toHaveBeenCalledWith({ x: 12, y: 34, zoom: 0.5 })
  })

  it('handles Safari gesture pinch events by zooming the canvas (and preventing browser zoom)', async () => {
    const mounted = mountGestures({ inputMode: 'auto', wheelBehavior: 'zoom', modality: 'mouse' })

    const startEvent = dispatchGesture(mounted.canvas, 'gesturestart', {
      scale: 1,
      clientX: 100,
      clientY: 50,
      timeStamp: 100,
    })
    expect(startEvent.defaultPrevented).toBe(true)

    const changeEvent = dispatchGesture(mounted.canvas, 'gesturechange', {
      scale: 2,
      clientX: 100,
      clientY: 50,
      timeStamp: 120,
    })
    expect(changeEvent.defaultPrevented).toBe(true)

    expect(mounted.setViewport).toHaveBeenCalledTimes(1)
    expect(mounted.setViewport).toHaveBeenCalledWith({ x: -100, y: -50, zoom: 2 }, { duration: 0 })

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(mounted.onViewportChange).toHaveBeenCalledTimes(1)
    expect(mounted.onViewportChange).toHaveBeenCalledWith({ x: -100, y: -50, zoom: 2 })
    expect(mounted.setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(true)

    dispatchGesture(mounted.canvas, 'gestureend')

    expect(mounted.setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)
  })

  it('keeps the canvas as the wheel owner after a gesture gap until pointer intent changes', async () => {
    const mounted = mountGestures({ withNode: true })
    const nodeTarget = mounted.nodeTarget as HTMLElement

    mounted.wheel(mounted.canvas, { deltaX: 100, timeStamp: 100 })

    await vi.advanceTimersByTimeAsync(16)
    nodeTarget.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    expect(mounted.trackpadGestureLockRef.current).toMatchObject({
      owner: 'canvas',
      phase: 'active',
    })
    mounted.wheel(nodeTarget, { deltaX: 100, timeStamp: 116 })
    expect(mounted.camera().x).toBe(-100)

    await vi.advanceTimersByTimeAsync(TRACKPAD_GESTURE_LOCK_GAP_MS)

    expect(mounted.trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'settling',
      lastTimestamp: 116,
    })

    mounted.wheel(nodeTarget, { deltaX: 100, timeStamp: 400 })

    expect(mounted.setViewport).toHaveBeenCalledTimes(3)
    expect(mounted.trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'active',
      lastTimestamp: 400,
    })

    await vi.advanceTimersByTimeAsync(TRACKPAD_GESTURE_LOCK_GAP_MS)

    expect(mounted.trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'settling',
      lastTimestamp: 400,
    })

    nodeTarget.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))

    expect(mounted.trackpadGestureLockRef.current).toBeNull()
    expect(mounted.setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)

    // This is the E2E failure sequence: an idle gap followed by pointer movement
    // intentionally routes the next wheel to the node, without another canvas pan.
    mounted.wheel(nodeTarget, { deltaX: 100, timeStamp: 700 })
    expect(mounted.setViewport).toHaveBeenCalledTimes(3)
    expect(mounted.camera().x).toBe(-150)
    expect(mounted.trackpadGestureLockRef.current).toMatchObject({ owner: 'node', phase: 'active' })
  })

  it('keeps viewport interaction active across sparse contiguous wheel gestures', async () => {
    const mounted = mountGestures()

    mounted.wheel(mounted.canvas, { deltaX: 80, timeStamp: 100 })
    expect(selectViewportInteractionActive(mounted.store.getState())).toBe(true)

    await vi.advanceTimersByTimeAsync(150)
    expect(selectViewportInteractionActive(mounted.store.getState())).toBe(true)

    mounted.wheel(mounted.canvas, { deltaX: 80, timeStamp: 260 })
    await vi.advanceTimersByTimeAsync(150)
    expect(selectViewportInteractionActive(mounted.store.getState())).toBe(true)

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)
    expect(selectViewportInteractionActive(mounted.store.getState())).toBe(false)
  })

  // #647 S8: the camera is React Flow's. A navigation animation moves it between events, and a
  // gesture that starts then continues from the camera on screen
  // (docs/ui/VIEWPORT_NAVIGATION_STANDARD.md section 4.1, invariant 2).
  describe('reads the camera React Flow shows when the event arrives', () => {
    it('pans from the camera an animation moved', () => {
      const mounted = mountGestures()

      mounted.moveCamera({ x: -300, y: 0, zoom: 1 })
      mounted.wheel(mounted.canvas, { deltaX: 100 })

      expect(mounted.setViewport).toHaveBeenCalledTimes(1)
      expect(mounted.setViewport).toHaveBeenCalledWith({ x: -350, y: 0, zoom: 1 }, { duration: 0 })
    })

    it('zooms from the camera an animation moved, anchored at the pointer', () => {
      const mounted = mountGestures()
      const camera = { x: -300, y: -40, zoom: 0.8 }
      const event = { deltaY: -10, ctrlKey: true, clientX: 100, clientY: 50 }

      mounted.moveCamera(camera)
      mounted.wheel(mounted.canvas, event)

      expect(mounted.setViewport).toHaveBeenCalledTimes(1)
      const zoom = camera.zoom * Math.pow(2, resolveWheelZoomDelta(event as WheelEvent))
      const [viewport] = mounted.setViewport.mock.calls[0] as [Camera]
      expect(viewport.zoom).toBeCloseTo(zoom, 6)
      // The flow point under the pointer before the zoom stays under it after.
      const flowX = (event.clientX - camera.x) / camera.zoom
      const flowY = (event.clientY - camera.y) / camera.zoom
      expect(viewport.x).toBeCloseTo(event.clientX - flowX * zoom, 6)
      expect(viewport.y).toBeCloseTo(event.clientY - flowY * zoom, 6)
    })

    it('starts a Safari pinch from the camera an animation moved', () => {
      const mounted = mountGestures({ inputMode: 'auto', wheelBehavior: 'zoom', modality: 'mouse' })

      mounted.moveCamera({ x: -300, y: 0, zoom: 1 })
      dispatchGesture(mounted.canvas, 'gesturestart', {
        scale: 1,
        clientX: 100,
        clientY: 50,
        timeStamp: 100,
      })
      dispatchGesture(mounted.canvas, 'gesturechange', {
        scale: 2,
        clientX: 100,
        clientY: 50,
        timeStamp: 120,
      })

      // The flow point (400, 50) was under the pointer; it stays there at zoom 2.
      expect(mounted.setViewport).toHaveBeenCalledWith(
        { x: -700, y: -50, zoom: 2 },
        { duration: 0 },
      )
    })

    it('compares a pinch change with the zoom React Flow shows', () => {
      const mounted = mountGestures({ inputMode: 'auto', wheelBehavior: 'zoom', modality: 'mouse' })

      dispatchGesture(mounted.canvas, 'gesturestart', { scale: 1, timeStamp: 100 })
      mounted.moveCamera({ x: 0, y: 0, zoom: 2 })
      const change = dispatchGesture(mounted.canvas, 'gesturechange', {
        scale: 2,
        timeStamp: 120,
      })

      // The pinch asks for zoom 2, which is where the camera already is: nothing to write.
      expect(mounted.setViewport).not.toHaveBeenCalled()
      expect(change.defaultPrevented).toBe(true)
    })

    it('chains consecutive events without a copy: each event starts where the last ended', () => {
      const mounted = mountGestures()

      mounted.wheel(mounted.canvas, { deltaX: 100, timeStamp: 100 })
      mounted.wheel(mounted.canvas, { deltaX: 100, timeStamp: 116 })
      mounted.wheel(mounted.canvas, { deltaX: 100, timeStamp: 132 })

      expect(mounted.setViewport.mock.calls.map(([viewport]) => viewport.x)).toEqual([
        -50, -100, -150,
      ])
      expect(mounted.camera()).toEqual({ x: -150, y: 0, zoom: 1 })
    })

    // the zoom path has its own settle timer; it commits the live camera too.
    it('commits the camera React Flow shows when a zoom settle timer fires', async () => {
      const mounted = mountGestures()

      mounted.wheel(mounted.canvas, { deltaY: -10, ctrlKey: true, clientX: 100, clientY: 50 })
      mounted.moveCamera({ x: 500, y: 7, zoom: 1.5 })

      await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

      expect(mounted.onViewportChange).toHaveBeenCalledTimes(1)
      expect(mounted.onViewportChange).toHaveBeenCalledWith({ x: 500, y: 7, zoom: 1.5 })
    })

    // a pinch reads React Flow's camera at its start, then scales that camera;
    // each change is relative to the start, so several changes do not compound, and the flow point
    // first under the fingers follows them.
    it('scales a pinch from the camera at its start across several changes', () => {
      const mounted = mountGestures({ inputMode: 'auto', wheelBehavior: 'zoom', modality: 'mouse' })

      dispatchGesture(mounted.canvas, 'gesturestart', { scale: 1, clientX: 100, clientY: 50 })
      dispatchGesture(mounted.canvas, 'gesturechange', { scale: 1.2, clientX: 100, clientY: 50 })
      dispatchGesture(mounted.canvas, 'gesturechange', { scale: 1.5, clientX: 120, clientY: 50 })

      // The flow point (100, 50) was under the fingers at the start; at zoom 1.5 it sits under them
      // where they are now (120, 50).
      expect(mounted.camera()).toEqual({ x: 120 - 100 * 1.5, y: 50 - 50 * 1.5, zoom: 1.5 })
    })

    // consecutive events of different kinds chain too; a pan divides its delta
    // by the zoom the previous zoom event left in React Flow's store.
    it('pans after a zoom by the zoom React Flow shows', () => {
      const mounted = mountGestures()

      mounted.wheel(mounted.canvas, { deltaY: -50, ctrlKey: true, timeStamp: 100 })
      const zoomed = mounted.camera()
      mounted.wheel(mounted.canvas, { deltaX: 100, timeStamp: 400 })

      expect(zoomed.zoom).not.toBe(1)
      expect(mounted.camera().x).toBeCloseTo(zoomed.x - 50 / zoomed.zoom, 6)
    })
  })
})
