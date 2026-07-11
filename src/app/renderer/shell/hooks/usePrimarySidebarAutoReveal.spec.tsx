import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrimarySidebarAutoReveal } from './usePrimarySidebarAutoReveal'

const openDelayMs = 140
const closeDelayMs = 420

describe('usePrimarySidebarAutoReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it('keeps the peek open while a sidebar interaction is active', () => {
    const { result, rerender } = renderHook(
      ({ isInteractionActive }) =>
        usePrimarySidebarAutoReveal({
          isCollapsed: true,
          isInteractionActive,
        }),
      { initialProps: { isInteractionActive: false } },
    )

    act(() => {
      result.current.handlePointerEnter()
      vi.advanceTimersByTime(openDelayMs)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      result.current.handlePointerLeave()
      vi.advanceTimersByTime(closeDelayMs / 2)
      rerender({ isInteractionActive: true })
      vi.advanceTimersByTime(closeDelayMs)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      rerender({ isInteractionActive: false })
    })
    act(() => {
      vi.advanceTimersByTime(closeDelayMs - 1)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isPeekOpen).toBe(false)
  })

  it('does not let a stale close timer win after the pointer returns', () => {
    const { result } = renderHook(() =>
      usePrimarySidebarAutoReveal({
        isCollapsed: true,
        isInteractionActive: false,
      }),
    )

    act(() => {
      result.current.handlePointerEnter()
      vi.advanceTimersByTime(openDelayMs)
      result.current.handlePointerLeave()
      vi.advanceTimersByTime(closeDelayMs / 2)
      result.current.handlePointerEnter()
      vi.advanceTimersByTime(closeDelayMs)
    })

    expect(result.current.isPeekOpen).toBe(true)
  })

  it('resets the transient peek when the sidebar is pinned', () => {
    const { result, rerender } = renderHook(
      ({ isCollapsed }) =>
        usePrimarySidebarAutoReveal({
          isCollapsed,
          isInteractionActive: true,
        }),
      { initialProps: { isCollapsed: true } },
    )

    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      rerender({ isCollapsed: false })
    })

    expect(result.current.isPeekOpen).toBe(false)
  })
})
