import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import type { TerminalHydrationResult } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'
import { createTerminalHydrationLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalHydrationLifecycle'
import {
  beginTerminalGeometryCommit,
  markTerminalGeometryAccepted,
  markTerminalGeometryCommitSettled,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('hydration retry lifecycle', () => {
  it('coalesces geometry notifications, runs single-flight and stops after acceptance', async () => {
    const terminal = {} as Terminal
    let accept!: (result: TerminalHydrationResult) => void
    const attempt = vi
      .fn()
      .mockResolvedValueOnce('retryable')
      .mockImplementationOnce(
        () =>
          new Promise<TerminalHydrationResult>(resolve => {
            accept = resolve
          }),
      )
    const owner = createTerminalHydrationLifecycle({ terminal, attempt, isDisposed: () => false })
    owner.start()
    owner.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(attempt).toHaveBeenCalledTimes(1)
    markTerminalGeometryAccepted(terminal, 2)
    markTerminalGeometryAccepted(terminal, 3)
    markTerminalGeometryAccepted(terminal, 4)
    await vi.advanceTimersByTimeAsync(0)
    expect(attempt.mock.calls).toEqual([[false], [true]])
    markTerminalGeometryAccepted(terminal, 5)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(attempt).toHaveBeenCalledTimes(2)
    accept('complete')
    await vi.advanceTimersByTimeAsync(0)
    owner.start()
    markTerminalGeometryAccepted(terminal, 6)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    owner.dispose()
  })

  it('uses the quiet period without geometry events and waits for an outstanding ACK to settle', async () => {
    const terminal = {} as Terminal
    const attempt = vi.fn().mockResolvedValueOnce('retryable').mockResolvedValue('complete')
    const owner = createTerminalHydrationLifecycle({ terminal, attempt, isDisposed: () => false })
    owner.start()
    await vi.advanceTimersByTimeAsync(99)
    expect(attempt).toHaveBeenCalledTimes(1)
    const pending = beginTerminalGeometryCommit(terminal)
    markTerminalGeometryAccepted(terminal, 2)
    await vi.advanceTimersByTimeAsync(101)
    expect(attempt).toHaveBeenCalledTimes(1)
    markTerminalGeometryCommitSettled(terminal, pending)
    await vi.advanceTimersByTimeAsync(0)
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    owner.dispose()
  })

  it.each(['unmount', 'session change'])(
    'cancels pending retries and geometry subscriptions on %s',
    async reason => {
      const terminal = {} as Terminal
      let disposed = false
      const attempt = vi.fn(async () => 'retryable' as const)
      const owner = createTerminalHydrationLifecycle({
        terminal,
        attempt,
        isDisposed: () => disposed,
      })
      owner.start()
      await vi.advanceTimersByTimeAsync(0)
      if (reason === 'unmount') {
        owner.dispose()
      } else {
        disposed = true
      }
      markTerminalGeometryAccepted(terminal, 2)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(attempt).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
      owner.dispose()
    },
  )
})
