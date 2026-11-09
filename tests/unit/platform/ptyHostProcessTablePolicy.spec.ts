// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentProcessReaper } from '@platform/process/ptyHost/agentProcessReaper'
import { parseProcessTable } from '@platform/process/ptyHost/posixProcessTable'
import { observePtyForeground } from '@platform/process/ptyHost/foregroundObservation'

const shell = '10 1 10 Mon Nov 9 12:00:00 2026 S+ /bin/zsh\n'
const child = '20 10 20 Mon Nov 9 12:00:01 2026 S sleep 30\n'
const orphan = child.replace('20 10 20', '20 1 20')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const foreground = (reaper: AgentProcessReaper, send = vi.fn()) => ({
  send,
  done: observePtyForeground({
    sessionId: 'a',
    rootPid: 10,
    hostInstanceId: 'h',
    observedAtMs: Date.now(),
    windowsExitCode: null,
    platform: 'darwin',
    readTable: () => reaper.readTable(),
    send,
    isCurrent: () => true,
  }),
})
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})
it('a 700ms foreground read still returns shellOnly instead of unavailable', async () => {
  const reaper = new AgentProcessReaper({
    readTable: async () => {
      await sleep(700)
      return parseProcessTable(shell)
    },
  })
  const probe = foreground(reaper)
  await vi.advanceTimersByTimeAsync(700)
  await probe.done
  expect(probe.send.mock.calls[0]?.[0]).toMatchObject({
    availability: 'available',
    shellOnly: true,
  })
})
it('a partial table supplies foreground evidence without pruning a missing owned orphan', async () => {
  let output = shell + child
  const readTable = vi.fn(async () => parseProcessTable(output))
  const signal = vi.fn()
  const reaper = new AgentProcessReaper({
    readTable,
    signal,
    now: () => Date.now(),
    reportIssue: vi.fn(),
  })
  await reaper.track('a', 10)
  output = shell + '20 incomplete\n'
  const parsed = parseProcessTable(output)
  expect(parsed).toMatchObject({ complete: false, rows: [expect.objectContaining({ pid: 10 })] })
  const probe = foreground(reaper)
  await probe.done
  expect(probe.send.mock.calls[0]?.[0]).toMatchObject({
    availability: 'available',
    shellOnly: true,
  })
  output = orphan
  const task = reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(2_000)
  await task
  expect(signal).toHaveBeenCalledWith(20, 'SIGKILL')
})
it('a timed-out foreground read clears in-flight state and a later probe can succeed', async () => {
  const readTable = vi.fn(async () => parseProcessTable(shell))
  readTable.mockImplementationOnce(() => new Promise(() => {}))
  const log = vi.fn()
  const reaper = new AgentProcessReaper({ readTable, reportIssue: log })
  const first = foreground(reaper)
  await vi.advanceTimersByTimeAsync(2_000)
  await first.done
  expect(first.send.mock.calls[0]?.[0]).toMatchObject({ availability: 'unavailable' })
  expect(log).toHaveBeenCalled()
  const second = foreground(reaper)
  await second.done
  expect(second.send.mock.calls[0]?.[0]).toMatchObject({
    availability: 'available',
    shellOnly: true,
  })
  expect(readTable).toHaveBeenCalledTimes(2)
})
it('three 700ms retirement reads still deliver KILL within the unchanged 3s budget', async () => {
  const signal = vi.fn()
  const reaper = new AgentProcessReaper({
    readTable: async () => {
      await sleep(700)
      return parseProcessTable(shell + child)
    },
    signal,
    now: () => Date.now(),
    reportIssue: vi.fn(),
  })
  const tracking = reaper.track('a', 10)
  await vi.advanceTimersByTimeAsync(700)
  await tracking
  const started = Date.now()
  let ended: number | undefined
  const task = reaper.terminate('a').then(() => {
    ended = Date.now()
  })
  await vi.advanceTimersByTimeAsync(3_000)
  await task
  expect(signal).toHaveBeenCalledWith(20, 'SIGKILL')
  expect(ended! - started).toBeLessThanOrEqual(3_000)
})
it('retirement preempts a hung 2s background sample rather than spending its KILL reserve', async () => {
  const signal = vi.fn()
  const readTable = vi.fn(async () => parseProcessTable(shell + child))
  const reaper = new AgentProcessReaper({
    readTable,
    signal,
    now: () => Date.now(),
    reportIssue: vi.fn(),
  })
  await reaper.track('a', 10)
  readTable.mockImplementationOnce(() => new Promise(() => {}))
  await vi.advanceTimersByTimeAsync(5_000)
  const task = reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(3_000)
  await task
  expect(signal).toHaveBeenCalledWith(20, 'SIGKILL')
})

it('20 simultaneous closes share slow stage reads and all reach KILL within 3s', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => {
    const rootPid = 1000 + index * 100
    return [
      {
        pid: rootPid,
        parentPid: 1,
        pgid: rootPid,
        startTime: `birth-${rootPid}`,
        command: 'fixture',
      },
      ...Array.from({ length: 20 }, (_member, childIndex) => ({
        pid: rootPid + childIndex + 1,
        parentPid: rootPid,
        pgid: rootPid + childIndex + 1,
        startTime: `birth-${rootPid + childIndex + 1}`,
        command: 'sleep',
      })),
    ]
  }).flat()
  const readTable = vi.fn(async () => ({ rows, complete: true }))
  const signal = vi.fn()
  const reaper = new AgentProcessReaper({ readTable, signal, now: () => Date.now() })
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => reaper.track(`s${index}`, 1000 + index * 100)),
  )
  readTable.mockClear().mockImplementation(async () => {
    await sleep(700)
    return { rows, complete: true }
  })
  const elapsed: number[] = []
  const started = Date.now()
  const tasks = Array.from({ length: 20 }, (_, index) =>
    reaper.terminate(`s${index}`).then(() => {
      elapsed.push(Date.now() - started)
    }),
  )
  await vi.advanceTimersByTimeAsync(3_000)
  await Promise.all(tasks)
  expect(Math.max(...elapsed)).toBeLessThanOrEqual(3_000)
  expect(readTable).toHaveBeenCalledTimes(3)
  expect(signal.mock.calls.filter(([, kind]) => kind === 'SIGKILL')).toHaveLength(420)
})
it('a partial retirement table keeps absent targets for validation at KILL', async () => {
  const readTable = vi.fn(async () => parseProcessTable(shell + child))
  const signal = vi.fn()
  const reaper = new AgentProcessReaper({ readTable, signal, now: () => Date.now() })
  await reaper.track('a', 10)
  readTable
    .mockImplementationOnce(async () => parseProcessTable(shell + '20 incomplete\n'))
    .mockImplementationOnce(async () => parseProcessTable(shell + '20 incomplete\n'))
    .mockImplementationOnce(async () => parseProcessTable(orphan))
  const task = reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(3_000)
  await task
  expect(signal).not.toHaveBeenCalledWith(20, 'SIGTERM')
  expect(signal).toHaveBeenCalledWith(20, 'SIGKILL')
})

it('an immediate close replaces a pending launch read before HUP without abandoning root capture', async () => {
  const readTable = vi.fn(async () => parseProcessTable(shell + child))
  readTable.mockImplementationOnce(() => new Promise(() => {}))
  const signal = vi.fn()
  const hangup = vi.fn()
  const reaper = new AgentProcessReaper({ readTable, signal, now: () => Date.now() })
  const tracking = reaper.track('a', 10)
  await vi.advanceTimersByTimeAsync(0)
  const task = reaper.terminate('a', hangup)
  await vi.advanceTimersByTimeAsync(3_000)
  await Promise.all([tracking, task])
  expect(hangup).toHaveBeenCalledOnce()
  expect(signal).toHaveBeenCalledWith(20, 'SIGKILL')
})

it('partial TERM output preserves a retirement-only identity outside the 512-member history', async () => {
  const readTable = vi.fn(async () => parseProcessTable(shell))
  const signal = vi.fn()
  const reaper = new AgentProcessReaper({
    readTable,
    signal,
    now: () => Date.now(),
    reportIssue: vi.fn(),
  })
  await reaper.track('a', 10)
  const children = Array.from(
    { length: 600 },
    (_, index) => `${100 + index} 10 ${100 + index} Mon Nov 9 12:00:01 2026 S sleep\n`,
  ).join('')
  readTable
    .mockImplementationOnce(async () => parseProcessTable(shell + children))
    .mockImplementationOnce(async () => parseProcessTable(shell + '699 incomplete\n'))
    .mockImplementationOnce(async () =>
      parseProcessTable('699 1 699 Mon Nov 9 12:00:01 2026 S sleep\n'),
    )
  const task = reaper.terminate('a')
  await vi.advanceTimersByTimeAsync(3_000)
  await task
  expect(signal).not.toHaveBeenCalledWith(699, 'SIGTERM')
  expect(signal).toHaveBeenCalledWith(699, 'SIGKILL')
})
