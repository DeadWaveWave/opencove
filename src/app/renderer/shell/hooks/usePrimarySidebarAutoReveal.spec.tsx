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

  function setupMenuInteraction() {
    const sidebar = document.createElement('aside')
    sidebar.className = 'workspace-sidebar'
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 40,
      right: 310,
      bottom: 720,
      width: 310,
      height: 680,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    })
    const menu = document.createElement('div')
    menu.className = 'workspace-context-menu'
    document.body.append(sidebar, menu)
    const hook = renderHook(
      ({ isInteractionActive }) =>
        usePrimarySidebarAutoReveal({
          isCollapsed: true,
          isInteractionActive,
        }),
      { initialProps: { isInteractionActive: false } },
    )
    act(() => {
      hook.result.current.handlePointerEnter()
      vi.advanceTimersByTime(openDelayMs)
    })
    act(() => hook.rerender({ isInteractionActive: true }))
    act(() => hook.result.current.handlePointerLeave())

    return {
      ...hook,
      pressMenuAt(clientX: number) {
        act(() => {
          menu.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, clientX, clientY: 300 }),
          )
          // A normal mouse press is longer than the old zero-delay action reset.
          vi.advanceTimersByTime(80)
        })
      },
      dismissMenu() {
        act(() => {
          menu.remove()
          hook.rerender({ isInteractionActive: false })
        })
      },
      cleanup() {
        hook.unmount()
        sidebar.remove()
        menu.remove()
      },
    }
  }

  function movePointer(clientX: number) {
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY: 300 }))
    })
  }

  function waitForCloseDelay() {
    act(() => vi.advanceTimersByTime(closeDelayMs + 50))
  }

  it('keeps navigation visible after a menu press while the pointer stays still over it', () => {
    const interaction = setupMenuInteraction()
    interaction.pressMenuAt(200)
    interaction.dismissMenu()
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(true)
    movePointer(220)
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(true)
    movePointer(500)
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(false)
    interaction.cleanup()
  })

  it('cancels closing when returning straight to navigation without passing the project icon', () => {
    const interaction = setupMenuInteraction()
    interaction.pressMenuAt(500)
    interaction.dismissMenu()
    act(() => vi.advanceTimersByTime(closeDelayMs / 2))
    movePointer(200)
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(true)
    movePointer(500)
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(false)
    interaction.cleanup()
  })

  it.each([200, 500])('uses current pointer location after keyboard dismissal at x=%i', clientX => {
    const interaction = setupMenuInteraction()
    interaction.pressMenuAt(200)
    movePointer(clientX)
    interaction.dismissMenu()
    waitForCloseDelay()
    expect(interaction.result.current.isPeekOpen).toBe(clientX < 310)
    interaction.cleanup()
  })

  it('does not reveal navigation just because a pointer moves over the closed rail', () => {
    const { result } = renderHook(() => usePrimarySidebarAutoReveal({ isCollapsed: true }))
    movePointer(20)
    waitForCloseDelay()
    expect(result.current.isPeekOpen).toBe(false)
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
