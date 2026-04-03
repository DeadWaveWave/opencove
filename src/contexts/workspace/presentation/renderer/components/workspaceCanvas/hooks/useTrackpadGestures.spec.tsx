import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { ReactFlowProvider, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasInputModalityState } from '../../../utils/inputModality'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasTrackpadGestures } from './useTrackpadGestures'

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

    await vi.advanceTimersByTimeAsync(120)

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 })
  })
})
