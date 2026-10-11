import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import { useApplyUiTheme } from './useApplyUiTheme'

function HookHost({ uiTheme }: { uiTheme: UiTheme }): null {
  useApplyUiTheme(uiTheme)
  return null
}

afterEach(() => {
  delete document.documentElement.dataset.coveTheme
  delete document.documentElement.dataset.coveThemeId
  delete document.documentElement.dataset.coveThemeBase
  document.documentElement.style.colorScheme = ''
  vi.restoreAllMocks()
})

describe('useApplyUiTheme', () => {
  it('writes both data-cove-theme and data-cove-theme-id for the dark base theme', () => {
    render(<HookHost uiTheme="dark" />)

    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('switches Pixel to its light counterpart and notifies chrome with the light base scheme', () => {
    const setTheme = vi.fn(async () => undefined)
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { windowChrome: { setTheme } },
    })
    const listener = vi.fn()
    window.addEventListener('opencove-theme-changed', listener)
    try {
      const { rerender } = render(<HookHost uiTheme="pixel" />)
      rerender(<HookHost uiTheme="pixel-light" />)
      expect(document.documentElement.dataset.coveTheme).toBe('light')
      expect(document.documentElement.dataset.coveThemeId).toBe('pixel-light')
      expect(document.documentElement.style.colorScheme).toBe('light')
      expect(setTheme).toHaveBeenLastCalledWith({ theme: 'light' })
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { theme: 'light', themeId: 'pixel-light' } }),
      )
      const eventCount = listener.mock.calls.length
      rerender(<HookHost uiTheme="pixel-light" />)
      expect(listener).toHaveBeenCalledTimes(eventCount)
    } finally {
      window.removeEventListener('opencove-theme-changed', listener)
    }
  })

  it('reapplies theme-id when only the named theme changes but base scheme stays the same', () => {
    const setTheme = vi.fn(async () => undefined)
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { windowChrome: { setTheme } },
    })

    const events: Array<{ theme: string; themeId: string }> = []
    const listener = (event: Event): void => {
      events.push((event as CustomEvent).detail)
    }
    window.addEventListener('opencove-theme-changed', listener)

    const { rerender } = render(<HookHost uiTheme="dark" />)
    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('dark')
    expect(setTheme).toHaveBeenCalledTimes(1)

    rerender(<HookHost uiTheme="ember" />)

    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('ember')
    expect(setTheme).toHaveBeenCalledTimes(1)

    rerender(<HookHost uiTheme="pixel" />)

    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('pixel')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(setTheme).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      { theme: 'dark', themeId: 'dark' },
      { theme: 'dark', themeId: 'ember' },
      { theme: 'dark', themeId: 'pixel' },
    ])

    window.removeEventListener('opencove-theme-changed', listener)
  })
})
