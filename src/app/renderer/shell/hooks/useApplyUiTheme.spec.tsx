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
  delete document.documentElement.dataset.coveFamily
  document.documentElement.style.colorScheme = ''
  vi.restoreAllMocks()
})

describe('useApplyUiTheme', () => {
  it('applies Cove dark through the generated family and the dark base scheme', () => {
    render(<HookHost uiTheme="dark" />)

    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('dark')
    expect(document.documentElement.dataset.coveFamily).toBe('cove')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('keeps Cove (System) in the Cove family while following the system appearance', () => {
    const listeners = new Set<() => void>()
    const query = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList)

    render(<HookHost uiTheme="system" />)
    expect(document.documentElement.dataset.coveTheme).toBe('light')
    expect(document.documentElement.dataset.coveThemeBase).toBe('light')
    expect(document.documentElement.dataset.coveFamily).toBe('cove')

    query.matches = true
    listeners.forEach(listener => listener())
    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeBase).toBe('dark')
    expect(document.documentElement.dataset.coveFamily).toBe('cove')
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
      expect(document.documentElement.dataset.coveFamily).toBe('pixel')
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
    expect(document.documentElement.dataset.coveFamily).toBe('cove')
    expect(setTheme).toHaveBeenCalledTimes(1)

    rerender(<HookHost uiTheme="pixel" />)

    expect(document.documentElement.dataset.coveTheme).toBe('dark')
    expect(document.documentElement.dataset.coveThemeId).toBe('pixel')
    expect(document.documentElement.dataset.coveFamily).toBe('pixel')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(setTheme).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      { theme: 'dark', themeId: 'dark' },
      { theme: 'dark', themeId: 'pixel' },
    ])

    window.removeEventListener('opencove-theme-changed', listener)
  })
})
