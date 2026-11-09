import { afterEach, expect, it, vi } from 'vitest'
import { retirePtyHostProcess } from '@platform/process/ptyHost/retireProcess'
import { TestPtyHostProcess } from './ptyHostSupervisor.testSupport'

afterEach(() => vi.useRealTimers())
it('lets the exact host finish cleanup before resolving disposal', async () => {
  const child = new TestPtyHostProcess()
  let done = false
  const task = retirePtyHostProcess(child, 'host').then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  expect(child.killCalls).toBe(0)
  child.emit('exit', 0)
  await task
  expect(done).toBe(true)
})
it('forces exact-child SIGKILL at the deadline, then bounds exit observation and reports failure', async () => {
  vi.useFakeTimers()
  const child = new TestPtyHostProcess()
  child.exitOnKill = false
  const report = vi.fn()
  let done = false
  const task = retirePtyHostProcess(child, 'host', report).then(() => {
    done = true
  })
  await vi.advanceTimersByTimeAsync(3_999)
  expect(child.killCalls).toBe(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(child.killSignals).toEqual(['SIGKILL'])
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(500)
  await task
  expect(report).toHaveBeenCalledWith(expect.stringContaining('exit unconfirmed'))
})
it('observes exit after SIGKILL, clears the final observation timer, and resolves once', async () => {
  vi.useFakeTimers()
  const child = new TestPtyHostProcess()
  const report = vi.fn()
  const task = retirePtyHostProcess(child, 'host', report)
  await vi.advanceTimersByTimeAsync(4_000)
  await task
  expect(child.killSignals).toEqual(['SIGKILL'])
  await vi.runAllTimersAsync()
  expect(report).not.toHaveBeenCalled()
})
it('cancels fallback after the exact child exits', async () => {
  vi.useFakeTimers()
  const child = new TestPtyHostProcess()
  const task = retirePtyHostProcess(child, 'host')
  child.emit('exit', 0)
  await task
  await vi.runAllTimersAsync()
  expect(child.killCalls).toBe(0)
})
it.each([true, false])(
  'uses TERM fallback for failed IPC/unready host, preserving final KILL (%s)',
  async failedIpc => {
    vi.useFakeTimers()
    const child = new TestPtyHostProcess()
    child.exitOnKill = false
    child.failPostMessageTypes.add('shutdown')
    const report = vi.fn()
    const task = retirePtyHostProcess(child, failedIpc ? 'host' : null, report)
    expect(child.killSignals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(4_500)
    await task
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
  },
)
