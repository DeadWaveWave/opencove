import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrimarySidebar } from './usePrimarySidebar'

describe('primary sidebar navigation mode', () => {
  let mobile = false
  let change: (() => void) | undefined
  const onTogglePinned = vi.fn()
  const options = {
    isCollapsed: true,
    hasBlockingOverlay: false,
    onTogglePinned,
  }

  beforeEach(() => {
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
    vi.unstubAllGlobals()
  })

  it('keeps mobile drawer state separate from the desktop collapsed preference', () => {
    mobile = true
    const { result, rerender } = renderHook(props => usePrimarySidebar(props), {
      initialProps: options,
    })
    expect(result.current.isDrawerOpen).toBe(false)
    act(() => result.current.toggle())
    expect(result.current).toMatchObject({ isDrawerOpen: true, isOpen: true, variant: 'docked' })
    expect(onTogglePinned).not.toHaveBeenCalled()
    rerender({ ...options, isCollapsed: false })
    expect(result.current).toMatchObject({ isDrawerOpen: true, isOpen: true, variant: 'docked' })
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

  it('derives desktop visibility from the persisted collapsed preference', () => {
    const { result, rerender } = renderHook(props => usePrimarySidebar(props), {
      initialProps: options,
    })
    expect(result.current).toMatchObject({ isOpen: false, variant: 'hidden' })
    act(() => result.current.toggle())
    expect(onTogglePinned).toHaveBeenCalledOnce()
    expect(result.current.isOpen).toBe(false)
    rerender({ ...options, isCollapsed: false })
    expect(result.current).toMatchObject({ isOpen: true, variant: 'docked' })
    act(() => result.current.toggle())
    expect(onTogglePinned).toHaveBeenCalledTimes(2)
    rerender(options)
    expect(result.current).toMatchObject({ isOpen: false, variant: 'hidden' })
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
