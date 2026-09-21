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

  it('keeps the peek open when a context menu action returns the pointer to the sidebar', () => {
    const { result, rerender } = renderHook(
      ({ isInteractionActive, isMenuOpen }) =>
        usePrimarySidebarAutoReveal({
          isCollapsed: true,
          isInteractionActive,
          isMenuOpen,
        }),
      {
        initialProps: { isInteractionActive: false, isMenuOpen: false },
      },
    )

    act(() => {
      result.current.handlePointerEnter()
      vi.advanceTimersByTime(openDelayMs)
      result.current.handlePointerLeave()
      rerender({ isInteractionActive: true, isMenuOpen: true })
    })
    expect(result.current.isPeekOpen).toBe(true)

    const menu = document.createElement('div')
    menu.className = 'workspace-context-menu'
    document.body.appendChild(menu)
    const sidebar = document.createElement('aside')
    sidebar.dataset.testid = 'workspace-sidebar'
    Object.defineProperty(sidebar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 240,
        bottom: 720,
        width: 240,
        height: 720,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    document.body.appendChild(sidebar)
    act(() => {
      menu.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          clientX: 120,
          clientY: 300,
        }),
      )
      menu.remove()
      rerender({ isInteractionActive: false, isMenuOpen: false })
      vi.advanceTimersByTime(closeDelayMs + 50)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 300 }))
      vi.advanceTimersByTime(closeDelayMs)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      result.current.handlePointerLeave()
      vi.advanceTimersByTime(closeDelayMs)
    })
    expect(result.current.isPeekOpen).toBe(false)
    menu.remove()
    sidebar.remove()
  })

  it('starts closing after a context menu action outside the sidebar', () => {
    const { result, rerender } = renderHook(
      ({ isInteractionActive, isMenuOpen }) =>
        usePrimarySidebarAutoReveal({
          isCollapsed: true,
          isInteractionActive,
          isMenuOpen,
        }),
      {
        initialProps: { isInteractionActive: false, isMenuOpen: false },
      },
    )

    act(() => {
      result.current.handlePointerEnter()
      vi.advanceTimersByTime(openDelayMs)
      result.current.handlePointerLeave()
      rerender({ isInteractionActive: true, isMenuOpen: true })
    })
    expect(result.current.isPeekOpen).toBe(true)

    const menu = document.createElement('div')
    menu.className = 'workspace-context-menu'
    document.body.appendChild(menu)
    const sidebar = document.createElement('aside')
    sidebar.dataset.testid = 'workspace-sidebar'
    Object.defineProperty(sidebar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 240,
        bottom: 720,
        width: 240,
        height: 720,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    document.body.appendChild(sidebar)

    act(() => {
      menu.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          clientX: 420,
          clientY: 300,
        }),
      )
      menu.remove()
      rerender({ isInteractionActive: false, isMenuOpen: false })
      vi.advanceTimersByTime(closeDelayMs - 1)
    })
    expect(result.current.isPeekOpen).toBe(true)

    act(() => {
      vi.advanceTimersByTime(closeDelayMs)
    })
    expect(result.current.isPeekOpen).toBe(false)
    menu.remove()
    sidebar.remove()
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
