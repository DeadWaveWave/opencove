import type React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalBodyClickFallback } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalBodyClickFallback'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('terminal body click routing', () => {
  it.each([false, true])('consumes the canvas selection click while link ownership is %s', link => {
    vi.useFakeTimers()
    const onInteractionStart = vi.fn()
    const { result } = renderHook(() => useTerminalBodyClickFallback(onInteractionStart))
    const target = document.createElement('div')
    target.className = 'terminal-node__terminal nodrag'
    if (link) {
      target.dataset.coveLinkGesture = 'true'
    }
    const event = {
      target,
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 30,
      shiftKey: false,
    } as unknown as React.PointerEvent<HTMLDivElement>
    act(() => {
      result.current.handlePointerDownCapture(event)
      result.current.handlePointerUp(event)
    })
    // The browser click follows pointerup even when the link owns navigation.
    expect(result.current.consumeIgnoredClick(target)).toBe(true)
    expect(result.current.consumeIgnoredClick(target)).toBe(false)
    act(() => vi.runOnlyPendingTimers())
    if (link) {
      expect(onInteractionStart).not.toHaveBeenCalled()
    } else {
      expect(onInteractionStart).toHaveBeenCalledExactlyOnceWith({
        normalizeViewport: true,
        selectNode: false,
        shiftKey: false,
      })
    }
  })
})
