import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useIslandCountdown } from './useIslandCountdown'

function Host({ paused, onExpire }: { paused: boolean; onExpire: () => void }): null {
  useIslandCountdown({ durationMs: 6_000, paused, onExpire })
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useIslandCountdown', () => {
  it('runs out after its duration', () => {
    const onExpire = vi.fn()
    render(<Host paused={false} onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(5_999))
    expect(onExpire).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('does not count the time it was paused', () => {
    const onExpire = vi.fn()
    const { rerender } = render(<Host paused={false} onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(2_000))

    rerender(<Host paused onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(60_000))
    expect(onExpire).not.toHaveBeenCalled()

    rerender(<Host paused={false} onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(3_999))
    expect(onExpire).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('waits from the start when it begins paused, and stops when it unmounts', () => {
    const onExpire = vi.fn()
    const { rerender, unmount } = render(<Host paused onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(10_000))
    rerender(<Host paused={false} onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(5_000))
    unmount()
    act(() => vi.advanceTimersByTime(10_000))
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('calls the latest handler', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(<Host paused={false} onExpire={first} />)
    rerender(<Host paused={false} onExpire={latest} />)
    act(() => vi.advanceTimersByTime(6_000))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })
})
