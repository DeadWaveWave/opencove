import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { WindowFocusState } from '@shared/contracts/dto'
import { useWindowFocused } from './useWindowFocused'

let latest: boolean | null = null

function HookHost(): null {
  latest = useWindowFocused()
  return null
}

function stubWindowChrome() {
  const listeners = new Set<(state: WindowFocusState) => void>()
  let answer: (state: WindowFocusState) => void = () => undefined
  const windowChrome = {
    getFocus: vi.fn(
      () =>
        new Promise<WindowFocusState>(resolve => {
          answer = resolve
        }),
    ),
    onFocusChange: vi.fn((listener: (state: WindowFocusState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: { windowChrome } })
  return {
    listeners,
    answer: async (isFocused: boolean) => {
      await act(async () => answer({ isFocused }))
    },
    emit: (isFocused: boolean) => {
      act(() => listeners.forEach(listener => listener({ isFocused })))
    },
  }
}

afterEach(() => {
  latest = null
  Reflect.deleteProperty(window, 'opencoveApi')
})

describe('useWindowFocused', () => {
  it('starts in front, then follows what main says about the window', async () => {
    const chrome = stubWindowChrome()
    render(<HookHost />)
    expect(latest).toBe(true)

    await chrome.answer(false)
    expect(latest).toBe(false)

    chrome.emit(true)
    expect(latest).toBe(true)
    chrome.emit(false)
    expect(latest).toBe(false)
  })

  it('keeps a change that lands before the first answer', async () => {
    const chrome = stubWindowChrome()
    render(<HookHost />)

    chrome.emit(false)
    await chrome.answer(true)
    expect(latest).toBe(false)
  })

  it('stops listening when it unmounts', () => {
    const chrome = stubWindowChrome()
    const { unmount } = render(<HookHost />)
    expect(chrome.listeners.size).toBe(1)
    unmount()
    expect(chrome.listeners.size).toBe(0)
  })

  it('stays in front without a window to ask', () => {
    render(<HookHost />)
    expect(latest).toBe(true)
  })
})
