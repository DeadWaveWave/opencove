// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentProcessReaper } from '@platform/process/ptyHost/agentProcessReaper'
import type { ProcessIdentity } from '@platform/process/ptyHost/posixProcessTable'

const row = (pid: number, parentPid: number, startTime = `birth-${pid}`): ProcessIdentity => ({
  pid,
  parentPid,
  pgid: pid,
  startTime,
  command: 'fixture',
})
function harness() {
  let rows = [row(10, 1), row(20, 10)]
  const signal = vi.fn()
  const log = vi.fn()
  const readTable = vi.fn(async () => ({ rows, complete: true }))
  const reaper = new AgentProcessReaper({
    readTable,
    signal,
    reportIssue: log,
    now: () => Date.now(),
    platform: 'linux',
  })
  return {
    reaper,
    signal,
    log,
    readTable,
    setRows: (value: ProcessIdentity[]) => {
      rows = value
    },
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('samples once per 5s for all agents, retains reparented ownership and prunes gone members', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  await h.reaper.track('b', 30)
  h.readTable.mockClear()
  h.setRows([row(10, 1), row(20, 1)])
  await vi.advanceTimersByTimeAsync(5_000)
  expect(h.readTable).toHaveBeenCalledOnce()
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
  h.setRows([])
  await vi.advanceTimersByTimeAsync(5_000)
  const other = h.reaper.terminate('b')
  await vi.advanceTimersByTimeAsync(2_000)
  await other
  h.readTable.mockClear()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.readTable).not.toHaveBeenCalled()
})
it('never adopts a replacement root or its child, even if the original exit notification is delayed', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.setRows([row(10, 1, 'replacement'), row(99, 10), row(20, 1)])
  const hangup = vi.fn()
  const task = h.reaper.terminate('a', hangup)
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(hangup).not.toHaveBeenCalled()
  expect(h.signal.mock.calls).toEqual([
    [20, 'SIGTERM'],
    [20, 'SIGKILL'],
  ])
})
it('does not signal a changed member identity at either escalation stage', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.setRows([row(20, 1, 'replacement')])
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).not.toHaveBeenCalled()
})
it('does not reap on natural exit but later close reaps its known leftover', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.reaper.noteExit('a')
  h.setRows([row(20, 1)])
  await vi.advanceTimersByTimeAsync(5_000)
  expect(h.signal).not.toHaveBeenCalled()
  const hangup = vi.fn()
  const task = h.reaper.terminate('a', hangup)
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(hangup).not.toHaveBeenCalled()
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
})
it('revalidates at KILL and captures children forked after HUP while root remains verified', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  const task = h.reaper.terminate('a', () => h.setRows([row(10, 1), row(20, 10), row(30, 10)]))
  await vi.advanceTimersByTimeAsync(200)
  expect(h.signal).toHaveBeenCalledWith(30, 'SIGTERM')
  h.setRows([row(10, 1), row(20, 1, 'replacement'), row(30, 1)])
  await vi.advanceTimersByTimeAsync(1_000)
  await task
  expect(h.signal).not.toHaveBeenCalledWith(20, 'SIGKILL')
  expect(h.signal).toHaveBeenCalledWith(30, 'SIGKILL')
})
it('20 simultaneous sessions use exactly three shared async stage reads and reach KILL within 3s', async () => {
  const h = harness()
  const rows = Array.from({ length: 20 }, (_, i) => {
    const root = 1000 + i * 1000
    return [row(root, 1), ...Array.from({ length: 100 }, (_member, j) => row(root + j + 1, root))]
  }).flat()
  h.setRows(rows)
  await Promise.all(Array.from({ length: 20 }, (_, i) => h.reaper.track(`s${i}`, 1000 + i * 1000)))
  h.readTable.mockClear()
  h.readTable.mockImplementation(async () => {
    await new Promise(done => setTimeout(done, 200))
    return { rows, complete: true }
  })
  const started = Date.now()
  const tasks = Array.from({ length: 20 }, (_, i) => h.reaper.terminate(`s${i}`))
  await vi.advanceTimersByTimeAsync(2_999)
  await Promise.all(tasks)
  expect(h.readTable).toHaveBeenCalledTimes(3)
  expect(h.signal.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(2020)
  expect(Date.now() - started).toBeLessThan(3_000)
  expect(h.signal.mock.calls.every(([pid]) => pid > 0)).toBe(true)
})
it('reserves KILL even when TERM sampling hangs, logging the failed stage', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.readTable
    .mockImplementationOnce(async () => ({ rows: [row(10, 1), row(20, 10)], complete: true }))
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockImplementationOnce(async () => ({ rows: [row(20, 1)], complete: true }))
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_999)
  await task
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
  expect(h.log).toHaveBeenCalled()
})
it('bounds ownership to 512 identities per session and logs overflow', async () => {
  const h = harness()
  h.setRows([row(10, 1), ...Array.from({ length: 600 }, (_, i) => row(i + 100, 10))])
  await h.reaper.track('a', 10)
  h.setRows(Array.from({ length: 600 }, (_, i) => row(i + 100, 1)))
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(
    h.signal.mock.calls.filter(([, signal]) => signal === 'SIGKILL').length,
  ).toBeLessThanOrEqual(512)
  expect(h.log).toHaveBeenCalledWith(expect.stringContaining('512'))
})
it('never binds root identity from a later sample after the initial read fails', async () => {
  const h = harness()
  h.readTable.mockRejectedValueOnce(new Error('denied'))
  await h.reaper.track('a', 10)
  h.setRows([row(10, 1, 'replacement'), row(99, 10)])
  const hangup = vi.fn()
  const task = h.reaper.terminate('a', hangup)
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(hangup).not.toHaveBeenCalled()
  expect(h.signal).not.toHaveBeenCalled()
})

it('does not bind a root which exits before its first sample completes', async () => {
  const h = harness()
  let finish!: (rows: ProcessIdentity[]) => void
  h.readTable.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = rows => resolve({ rows, complete: true })
      }),
  )
  const tracking = h.reaper.track('a', 10)
  await vi.advanceTimersByTimeAsync(0)
  h.reaper.noteExit('a')
  finish([row(10, 1, 'replacement'), row(99, 10)])
  await tracking
  const hangup = vi.fn()
  const task = h.reaper.terminate('a', hangup)
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(hangup).not.toHaveBeenCalled()
  expect(h.signal).not.toHaveBeenCalled()
})
it('coalesces duplicate close, drains together on quit, and keeps KILL despite signal errors', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.signal.mockImplementation((pid: number) => {
    if (pid === 20) {
      throw new Error('denied')
    }
  })
  const first = h.reaper.terminate('a')
  expect(h.reaper.terminate('a')).toBe(first)
  const draining = h.reaper.drain()
  await vi.advanceTimersByTimeAsync(2_000)
  await Promise.all([first, draining])
  expect(h.signal).toHaveBeenCalledWith(10, 'SIGKILL')
  expect(h.log).toHaveBeenCalled()
})

it('keeps the full current retirement tree across HUP even when lifetime history exceeds 512', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  const descendants = Array.from({ length: 600 }, (_, i) => row(i + 100, 10))
  h.setRows([row(10, 1), ...descendants])
  const task = h.reaper.terminate('a', () =>
    h.setRows(descendants.map(member => ({ ...member, parentPid: 1 }))),
  )
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(600)
})
