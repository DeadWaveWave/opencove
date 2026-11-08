// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createPtyHostShutdown } from '@platform/process/ptyHost/shutdown'
import { PTY_HOST_SHUTDOWN_TIMEOUT_MS } from '@platform/process/ptyHost/terminationTiming'

afterEach(() => {
  vi.useRealTimers()
})
it('keeps one shared drain alive through repeated shutdown sources and cancels the deadline on success', async () => {
  vi.useFakeTimers()
  let finishDrain!: () => void
  const cleanup = vi.fn()
  const drain = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finishDrain = resolve
      }),
  )
  const exit = vi.fn()
  const reportIssue = vi.fn()
  const request = createPtyHostShutdown({ cleanup, drain, exit, reportIssue })
  const first = request()
  expect(request()).toBe(first)
  expect(cleanup).toHaveBeenCalledOnce()
  expect(drain).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(PTY_HOST_SHUTDOWN_TIMEOUT_MS - 1)
  expect(exit).not.toHaveBeenCalled()
  finishDrain()
  await first
  expect(exit).toHaveBeenCalledExactlyOnceWith(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(exit).toHaveBeenCalledOnce()
  expect(reportIssue).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('attempts drain after cleanup failure and never exits twice when drain settles after the deadline', async () => {
  vi.useFakeTimers()
  let rejectDrain!: (error: Error) => void
  const exit = vi.fn()
  const reportIssue = vi.fn()
  const drain = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectDrain = reject
      }),
  )
  const request = createPtyHostShutdown({
    cleanup: () => {
      throw new Error('cleanup failed')
    },
    drain,
    exit,
    reportIssue,
  })
  const first = request()
  expect(drain).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(PTY_HOST_SHUTDOWN_TIMEOUT_MS)
  await first
  expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  const loggedAtExit = reportIssue.mock.calls.length
  rejectDrain(new Error('late drain failure'))
  await Promise.resolve()
  expect(exit).toHaveBeenCalledOnce()
  expect(reportIssue).toHaveBeenCalledTimes(loggedAtExit)
})
