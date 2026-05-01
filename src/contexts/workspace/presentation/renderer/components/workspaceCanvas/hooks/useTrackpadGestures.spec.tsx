import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasInputModalityState } from '../../../utils/inputModality'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasTrackpadGestures } from './useTrackpadGestures'
import { VIEWPORT_INTERACTION_SETTLE_MS } from '../constants'
import { selectViewportInteractionActive } from '../../terminalNode/reactFlowState'

type WheelHandler = (event: WheelEvent) => void

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
    const handlerRef = { current: null as WheelHandler | null }
    const canvasRef = { current: null as HTMLDivElement | null }
    const trackpadGestureLockRef = { current: null }
    const viewportRef = { current: { x: 0, y: 0, zoom: 1 } }
    const inputModalityStateRef = { current: createCanvasInputModalityState('trackpad') }
    const setDetectedCanvasInputMode = vi.fn()
    const setIsCanvasWheelGestureCaptureActive = vi.fn()
    const reactFlow = {
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const onViewportChange = vi.fn()

    function TestHarness(): React.JSX.Element {
      const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
        canvasInputModeSetting: 'trackpad',
        canvasWheelBehaviorSetting: 'pan',
        canvasWheelZoomModifierSetting: 'primary',
        resolvedCanvasInputMode: 'trackpad',
        inputModalityStateRef,
        setDetectedCanvasInputMode,
        canvasRef,
        trackpadGestureLockRef,
        setIsCanvasWheelGestureCaptureActive,
        viewportRef,
        reactFlow,
        onViewportChange,
      })

      useEffect(() => {
        handlerRef.current = handleCanvasWheelCapture
      }, [handleCanvasWheelCapture])

      return (
        <div
          ref={node => {
            canvasRef.current = node
          }}
        />
      )
    }

    render(
      <ReactFlowProvider>
        <TestHarness />
      </ReactFlowProvider>,
    )

    const wheelHandler = handlerRef.current
    expect(wheelHandler).toBeTypeOf('function')

    const target = canvasRef.current
    expect(target).not.toBeNull()

    wheelHandler?.({
      deltaX: 100,
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
    } as unknown as WheelEvent)

    expect(reactFlow.setViewport).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledTimes(0)
    expect(setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(true)

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 })

    await vi.advanceTimersByTimeAsync(100)

    expect(setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)
  })

  it('handles Safari gesture pinch events by zooming the canvas (and preventing browser zoom)', async () => {
    const canvasRef = { current: null as HTMLDivElement | null }
    const trackpadGestureLockRef = { current: null }
    const viewportRef = { current: { x: 0, y: 0, zoom: 1 } }
    const inputModalityStateRef = { current: createCanvasInputModalityState('mouse') }
    const setDetectedCanvasInputMode = vi.fn()
    const setIsCanvasWheelGestureCaptureActive = vi.fn()
    const reactFlow = {
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const onViewportChange = vi.fn()

    function TestHarness(): React.JSX.Element {
      useWorkspaceCanvasTrackpadGestures({
        canvasInputModeSetting: 'auto',
        canvasWheelBehaviorSetting: 'zoom',
        canvasWheelZoomModifierSetting: 'primary',
        resolvedCanvasInputMode: 'trackpad',
        inputModalityStateRef,
        setDetectedCanvasInputMode,
        canvasRef,
        trackpadGestureLockRef,
        setIsCanvasWheelGestureCaptureActive,
        viewportRef,
        reactFlow,
        onViewportChange,
      })

      return (
        <div
          ref={node => {
            canvasRef.current = node
          }}
        />
      )
    }

    render(
      <ReactFlowProvider>
        <TestHarness />
      </ReactFlowProvider>,
    )

    const target = canvasRef.current
    expect(target).not.toBeNull()

    const startEvent = new Event('gesturestart', { bubbles: true, cancelable: true })
    Object.defineProperty(startEvent, 'scale', { value: 1, configurable: true })
    Object.defineProperty(startEvent, 'clientX', { value: 100, configurable: true })
    Object.defineProperty(startEvent, 'clientY', { value: 50, configurable: true })
    Object.defineProperty(startEvent, 'timeStamp', { value: 100, configurable: true })
    target?.dispatchEvent(startEvent)
    expect(startEvent.defaultPrevented).toBe(true)

    const changeEvent = new Event('gesturechange', { bubbles: true, cancelable: true })
    Object.defineProperty(changeEvent, 'scale', { value: 2, configurable: true })
    Object.defineProperty(changeEvent, 'clientX', { value: 100, configurable: true })
    Object.defineProperty(changeEvent, 'clientY', { value: 50, configurable: true })
    Object.defineProperty(changeEvent, 'timeStamp', { value: 120, configurable: true })
    target?.dispatchEvent(changeEvent)
    expect(changeEvent.defaultPrevented).toBe(true)

    expect(reactFlow.setViewport).toHaveBeenCalledTimes(1)
    expect(reactFlow.setViewport).toHaveBeenCalledWith(
      { x: -100, y: -50, zoom: 2 },
      { duration: 0 },
    )

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ x: -100, y: -50, zoom: 2 })
    expect(setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(true)

    target?.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }))

    expect(setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)
  })

  it('keeps the canvas as the wheel owner after a gesture gap until pointer intent changes', async () => {
    const handlerRef = { current: null as WheelHandler | null }
    const canvasRef = { current: null as HTMLDivElement | null }
    const trackpadGestureLockRef = { current: null }
    const viewportRef = { current: { x: 0, y: 0, zoom: 1 } }
    const inputModalityStateRef = { current: createCanvasInputModalityState('trackpad') }
    const setDetectedCanvasInputMode = vi.fn()
    const setIsCanvasWheelGestureCaptureActive = vi.fn()
    const reactFlow = {
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const onViewportChange = vi.fn()

    function TestHarness(): React.JSX.Element {
      const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
        canvasInputModeSetting: 'trackpad',
        canvasWheelBehaviorSetting: 'pan',
        canvasWheelZoomModifierSetting: 'primary',
        resolvedCanvasInputMode: 'trackpad',
        inputModalityStateRef,
        setDetectedCanvasInputMode,
        canvasRef,
        trackpadGestureLockRef,
        setIsCanvasWheelGestureCaptureActive,
        viewportRef,
        reactFlow,
        onViewportChange,
      })

      useEffect(() => {
        handlerRef.current = handleCanvasWheelCapture
      }, [handleCanvasWheelCapture])

      return (
        <div
          ref={node => {
            canvasRef.current = node
          }}
        >
          <div className="react-flow__node">
            <div data-testid="node-target" />
          </div>
        </div>
      )
    }

    const { getByTestId } = render(
      <ReactFlowProvider>
        <TestHarness />
      </ReactFlowProvider>,
    )

    const wheelHandler = handlerRef.current
    const canvasTarget = canvasRef.current
    const nodeTarget = getByTestId('node-target')
    expect(wheelHandler).toBeTypeOf('function')
    expect(canvasTarget).not.toBeNull()

    wheelHandler?.({
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      timeStamp: 100,
      clientX: 0,
      clientY: 0,
      target: canvasTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as WheelEvent)

    await vi.advanceTimersByTimeAsync(220)

    expect(trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'settling',
      lastTimestamp: 100,
    })

    wheelHandler?.({
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      timeStamp: 400,
      clientX: 0,
      clientY: 0,
      target: nodeTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as WheelEvent)

    expect(reactFlow.setViewport).toHaveBeenCalledTimes(2)
    expect(trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'active',
      lastTimestamp: 400,
    })

    await vi.advanceTimersByTimeAsync(220)

    expect(trackpadGestureLockRef.current).toMatchObject({
      action: 'pan',
      owner: 'canvas',
      phase: 'settling',
      lastTimestamp: 400,
    })

    nodeTarget.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))

    expect(trackpadGestureLockRef.current).toBeNull()
    expect(setIsCanvasWheelGestureCaptureActive).toHaveBeenCalledWith(false)
  })

  it('keeps viewport interaction active across sparse contiguous wheel gestures', async () => {
    const handlerRef = { current: null as WheelHandler | null }
    const storeRef = {
      current: null as ReturnType<typeof useStoreApi<Node<TerminalNodeData>>> | null,
    }
    const canvasRef = { current: null as HTMLDivElement | null }
    const trackpadGestureLockRef = { current: null }
    const viewportRef = { current: { x: 0, y: 0, zoom: 1 } }
    const inputModalityStateRef = { current: createCanvasInputModalityState('trackpad') }
    const setDetectedCanvasInputMode = vi.fn()
    const setIsCanvasWheelGestureCaptureActive = vi.fn()
    const reactFlow = {
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const onViewportChange = vi.fn()

    function TestHarness(): React.JSX.Element {
      const store = useStoreApi<Node<TerminalNodeData>>()
      const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
        canvasInputModeSetting: 'trackpad',
        canvasWheelBehaviorSetting: 'pan',
        canvasWheelZoomModifierSetting: 'primary',
        resolvedCanvasInputMode: 'trackpad',
        inputModalityStateRef,
        setDetectedCanvasInputMode,
        canvasRef,
        trackpadGestureLockRef,
        setIsCanvasWheelGestureCaptureActive,
        viewportRef,
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
        />
      )
    }

    render(
      <ReactFlowProvider>
        <TestHarness />
      </ReactFlowProvider>,
    )

    const target = canvasRef.current
    const wheelHandler = handlerRef.current
    expect(target).not.toBeNull()
    expect(wheelHandler).toBeTypeOf('function')

    const dispatchWheel = (timeStamp: number): void => {
      wheelHandler?.({
        deltaX: 80,
        deltaY: 0,
        deltaMode: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        timeStamp,
        clientX: 0,
        clientY: 0,
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as WheelEvent)
    }

    dispatchWheel(100)
    expect(selectViewportInteractionActive(storeRef.current?.getState())).toBe(true)

    await vi.advanceTimersByTimeAsync(150)
    expect(selectViewportInteractionActive(storeRef.current?.getState())).toBe(true)

    dispatchWheel(260)
    await vi.advanceTimersByTimeAsync(150)
    expect(selectViewportInteractionActive(storeRef.current?.getState())).toBe(true)

    await vi.advanceTimersByTimeAsync(VIEWPORT_INTERACTION_SETTLE_MS)
    expect(selectViewportInteractionActive(storeRef.current?.getState())).toBe(false)
  })
})
