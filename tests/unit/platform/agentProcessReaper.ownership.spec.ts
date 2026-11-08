// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentProcessReaper } from '@platform/process/ptyHost/agentProcessReaper'
import {
  parseProcessTable,
  type ProcessIdentity,
} from '@platform/process/ptyHost/posixProcessTable'

const row = (pid: number, parentPid: number, startTime = `birth-${pid}`): ProcessIdentity => ({
  pid,
  parentPid,
  pgid: pid,
  startTime,
  command: 'fixture',
})
function harness() {
  let rows = [row(10, 1), row(20, 10), row(100, 1)]
  const signal = vi.fn()
  const readTable = vi.fn(async () => rows)
  const reaper = new AgentProcessReaper({
    platform: 'linux',
    now: () => Date.now(),
    readTable,
    signal,
    reportIssue: vi.fn(),
  })
  return {
    reaper,
    signal,
    readTable,
    setRows: (value: ProcessIdentity[]) => {
      rows = value
    },
  }
}
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

it('a close arriving during another HUP read waits for its own post-close snapshot', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  await h.reaper.track('b', 100)
  let finishA!: (rows: ProcessIdentity[]) => void
  let finishB!: (rows: ProcessIdentity[]) => void
  h.readTable
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishA = resolve
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishB = resolve
        }),
    )
  const a = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(0)
  h.setRows([row(10, 1), row(100, 1), row(200, 100)])
  const hangupB = vi.fn(() => h.setRows([row(10, 1), row(200, 1)]))
  const b = h.reaper.terminate('b', hangupB)
  finishA([row(10, 1), row(100, 1)])
  await vi.advanceTimersByTimeAsync(0)
  expect(hangupB).not.toHaveBeenCalled()
  expect(finishB).toBeTypeOf('function')
  finishB([row(10, 1), row(100, 1), row(200, 100)])
  await vi.advanceTimersByTimeAsync(0)
  expect(hangupB).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(2_000)
  await Promise.all([a, b])
  expect(h.signal).toHaveBeenCalledWith(200, 'SIGKILL')
})
it('discovers descendants created by a validated owned orphan across periodic samples', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.setRows([row(20, 1), row(30, 20)])
  await vi.advanceTimersByTimeAsync(10_000)
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).toHaveBeenCalledWith(30, 'SIGTERM')
  expect(h.signal).toHaveBeenCalledWith(30, 'SIGKILL')
})
it('discovers post-HUP workers from retirement-only members beyond the history bound', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  const children = Array.from({ length: 600 }, (_, index) => row(1000 + index, 10))
  h.setRows([row(10, 1), ...children])
  // 1599 is outside the first 512 lifetime members, so only retirement retains it.
  const task = h.reaper.terminate('a', () =>
    h.setRows([...children.map(member => ({ ...member, parentPid: 1 })), row(5000, 1599)]),
  )
  await vi.advanceTimersByTimeAsync(200)
  expect(h.signal).toHaveBeenCalledWith(5000, 'SIGTERM')
  h.setRows([row(1599, 1), row(5000, 1599), row(5001, 5000)])
  await vi.advanceTimersByTimeAsync(1_000)
  await task
  expect(h.signal).toHaveBeenCalledWith(5001, 'SIGKILL')
})
it('does not seed ancestry from a recycled owned PID or signal its unrelated children', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.setRows([row(20, 1, 'replacement'), row(30, 20)])
  await vi.advanceTimersByTimeAsync(5_000)
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).not.toHaveBeenCalled()
})
it('preserves orphan ownership through a partially malformed stdout sample and later valid output', async () => {
  const h = harness()
  const root = '10 1 10 Mon Nov 9 12:00:00 2026 S root\n'
  const orphan = '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n'
  h.setRows(parseProcessTable(root + orphan.replace('20 1 20', '20 10 20')))
  await h.reaper.track('a', 10)
  h.readTable.mockImplementationOnce(async () => parseProcessTable(root + '20 incomplete\n'))
  await vi.advanceTimersByTimeAsync(5_000)
  h.setRows(parseProcessTable(orphan))
  await vi.advanceTimersByTimeAsync(5_000)
  const task = h.reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
})
it('coalesces twenty sequential foreground observations within one sample interval', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.readTable.mockClear()
  for (let index = 0; index < 20; index++) {
    // eslint-disable-next-line no-await-in-loop -- Replay sequential probes, not simultaneous calls.
    await h.reaper.readTable()
    // eslint-disable-next-line no-await-in-loop -- Probe spacing stays within the same 5s sample interval.
    await vi.advanceTimersByTimeAsync(100)
  }
  expect(h.readTable).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(3_000)
  expect(h.readTable).toHaveBeenCalledOnce()
  const drain = h.reaper.drain()
  await vi.advanceTimersByTimeAsync(2_000)
  await drain
})

it('preserves the 40-session staggered-close bound with 399ms fresh reads and no remaining timers', async () => {
  const h = harness()
  const rows = Array.from({ length: 40 }, (_, index) => row(1000 + index, 1))
  h.setRows(rows)
  await Promise.all(rows.map(member => h.reaper.track(String(member.pid), member.pid)))
  h.readTable.mockImplementation(async () => {
    const snapshot = rows.map(member => ({ ...member }))
    await new Promise(resolve => setTimeout(resolve, 399))
    return snapshot
  })
  const elapsed: number[] = []
  rows.forEach((member, index) =>
    setTimeout(() => {
      const started = Date.now()
      void h.reaper.terminate(String(member.pid)).then(() => elapsed.push(Date.now() - started))
    }, index * 50),
  )
  await vi.advanceTimersByTimeAsync(6_000)
  expect(elapsed).toHaveLength(40)
  expect(Math.max(...elapsed)).toBeLessThanOrEqual(3_000)
  expect(h.signal.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(40)
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects recycled retirement-only seeds and their unrelated descendants', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  h.setRows([row(10, 1), ...Array.from({ length: 600 }, (_, index) => row(1000 + index, 10))])
  const task = h.reaper.terminate('a', () =>
    h.setRows([row(1599, 1, 'replacement'), row(5000, 1599)]),
  )
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(h.signal).not.toHaveBeenCalledWith(1599, 'SIGTERM')
  expect(h.signal).not.toHaveBeenCalledWith(1599, 'SIGKILL')
  expect(h.signal).not.toHaveBeenCalledWith(5000, 'SIGTERM')
  expect(h.signal).not.toHaveBeenCalledWith(5000, 'SIGKILL')
})
it('piggybacks foreground observations onto a pending periodic sample', async () => {
  const h = harness()
  await h.reaper.track('a', 10)
  let finish!: (rows: ProcessIdentity[]) => void
  h.readTable.mockClear()
  h.readTable.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  await vi.advanceTimersByTimeAsync(5_000)
  const pending = Array.from({ length: 20 }, () => h.reaper.readTable())
  expect(h.readTable).toHaveBeenCalledOnce()
  const rows = [row(10, 1), row(20, 10)]
  finish(rows)
  expect((await Promise.all(pending)).every(value => value === rows)).toBe(true)
  expect(h.readTable).toHaveBeenCalledOnce()
  const drain = h.reaper.drain()
  await vi.advanceTimersByTimeAsync(2_000)
  await drain
})
