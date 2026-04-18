import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useApplyUiTheme } from './useApplyUiTheme'

function HookHost({ uiTheme }: { uiTheme: 'system' | 'light' | 'dark' | 'ember' }): null {
  useApplyUiTheme(uiTheme)
  return null
}

afterEach(() => {
  delete document.documentElement.dataset.coveTheme
  delete document.documentElement.dataset.coveThemeId
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
    expect(events).toEqual([
      { theme: 'dark', themeId: 'dark' },
      { theme: 'dark', themeId: 'ember' },
    ])

    window.removeEventListener('opencove-theme-changed', listener)
  })
})
