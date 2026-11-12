import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { WindowFullScreenState } from '@shared/contracts/dto'
import { useWindowFullScreen } from './useWindowFullScreen'

let latest: boolean | null = null

function HookHost(): null {
  latest = useWindowFullScreen()
  return null
}

function stubWindowChrome() {
  const listeners = new Set<(state: WindowFullScreenState) => void>()
  let answer: (state: WindowFullScreenState) => void = () => undefined
  const windowChrome = {
    setTheme: vi.fn(async () => undefined),
    getFullScreen: vi.fn(
      () =>
        new Promise<WindowFullScreenState>(resolve => {
          answer = resolve
        }),
    ),
    onFullScreenChange: vi.fn((listener: (state: WindowFullScreenState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: { windowChrome } })
  return {
    listeners,
    answer: async (isFullScreen: boolean) => {
      await act(async () => answer({ isFullScreen }))
    },
    emit: (isFullScreen: boolean) => {
      act(() => listeners.forEach(listener => listener({ isFullScreen })))
    },
  }
}

afterEach(() => {
  latest = null
  Reflect.deleteProperty(window, 'opencoveApi')
})

describe('useWindowFullScreen', () => {
  it('starts from the window state and follows its full-screen changes', async () => {
    const chrome = stubWindowChrome()
    render(<HookHost />)
    expect(latest).toBe(false)

    await chrome.answer(true)
    expect(latest).toBe(true)

    chrome.emit(false)
    expect(latest).toBe(false)
    chrome.emit(true)
    expect(latest).toBe(true)
  })

  it('keeps a change that lands before the initial answer', async () => {
    const chrome = stubWindowChrome()
    render(<HookHost />)

    chrome.emit(true)
    await chrome.answer(false)
    expect(latest).toBe(true)
  })

  it('stops listening when unmounted', () => {
    const chrome = stubWindowChrome()
    const { unmount } = render(<HookHost />)
    expect(chrome.listeners.size).toBe(1)

    unmount()
    expect(chrome.listeners.size).toBe(0)
  })

  it('reads windowed without a window chrome bridge', () => {
    render(<HookHost />)
    expect(latest).toBe(false)
  })
})
