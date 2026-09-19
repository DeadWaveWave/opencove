import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCollapsedTerminalActivity } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCollapsedTerminalActivity'

const source = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({
  getPtyEventHub: () => ({ onSessionData: source.subscribe }),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('collapsed terminal output indicator', () => {
  it('lights only on output, expires and clears the subscription on session change and disable', () => {
    vi.useFakeTimers()
    let output: (event: { data: string }) => void = () => undefined
    source.subscribe.mockImplementation((_id, listener) => {
      output = listener
      return source.unsubscribe
    })
    const icon = { current: document.createElement('span') }
    const { rerender, unmount } = renderHook(
      ({ sessionId, enabled }) => useCollapsedTerminalActivity(sessionId, enabled, icon),
      { initialProps: { sessionId: 'pty-1', enabled: true } },
    )
    expect(icon.current.dataset.outputActive).toBeUndefined()
    act(() => output({ data: 'real output' }))
    expect(icon.current.dataset.outputActive).toBe('true')
    act(() => vi.advanceTimersByTime(1_051))
    expect(icon.current.dataset.outputActive).toBeUndefined()
    act(() => output({ data: 'more output' }))
    rerender({ sessionId: 'pty-2', enabled: true })
    expect(source.unsubscribe).toHaveBeenCalledTimes(1)
    expect(icon.current.dataset.outputActive).toBeUndefined()
    expect(source.subscribe).toHaveBeenLastCalledWith('pty-2', expect.any(Function))
    rerender({ sessionId: 'pty-2', enabled: false })
    expect(source.unsubscribe).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })
})
