import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrimarySidebar } from './usePrimarySidebar'

describe('primary sidebar navigation mode', () => {
  let mobile = false
  let change: (() => void) | undefined
  const onTogglePinned = vi.fn()
  const options = {
    isCollapsed: true,
    isMenuOpen: false,
    hasBlockingOverlay: false,
    onTogglePinned,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mobile = false
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: mobile,
        addEventListener: (_event: string, listener: () => void) => {
          change = listener
        },
        removeEventListener: vi.fn(),
      })),
    )
    onTogglePinned.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps mobile drawer state separate from the desktop pin preference', () => {
    mobile = true
    const { result, rerender } = renderHook(props => usePrimarySidebar(props), {
      initialProps: options,
    })
    expect(result.current.isDrawerOpen).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.isDrawerOpen).toBe(true)
    expect(onTogglePinned).not.toHaveBeenCalled()
    rerender({ ...options, isCollapsed: false })
    expect(result.current.isDrawerOpen).toBe(true)
    act(() => result.current.close())
    expect(result.current.isDrawerOpen).toBe(false)
  })

  it('clears transient drawer state across viewport mode changes', () => {
    mobile = true
    const { result } = renderHook(() => usePrimarySidebar(options))
    act(() => result.current.toggle())
    act(() => {
      mobile = false
      change?.()
    })
    expect(result.current.isDrawerOpen).toBe(false)
    act(() => result.current.toggle())
    expect(onTogglePinned).toHaveBeenCalledOnce()
    act(() => {
      mobile = true
      change?.()
    })
    expect(result.current.isDrawerOpen).toBe(false)
  })

  it('does not auto reveal from touch, and keeps desktop dragging visible', () => {
    const { result } = renderHook(() => usePrimarySidebar(options))
    act(() => {
      result.current.onPointerEnter({ pointerType: 'touch' } as React.PointerEvent<HTMLElement>)
      vi.advanceTimersByTime(200)
    })
    expect(result.current.variant).toBe('rail')
    act(() => result.current.setDragging(true))
    act(() => {
      result.current.onPointerLeave()
      vi.advanceTimersByTime(500)
    })
    expect(result.current.variant).toBe('peek')
    act(() => result.current.setDragging(false))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.variant).toBe('rail')
  })

  it('dismisses the drawer when a blocking application surface opens', () => {
    mobile = true
    const { result, rerender } = renderHook(props => usePrimarySidebar(props), {
      initialProps: options,
    })
    act(() => result.current.toggle())
    rerender({ ...options, hasBlockingOverlay: true })
    expect(result.current.isDrawerOpen).toBe(false)
  })
})
