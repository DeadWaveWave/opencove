import { WindowsPtyResizeOwner } from '@platform/process/ptyHost/windowsPtyResizeOwner'
import { WindowsConsoleGeometryObserver } from '@platform/process/ptyHost/windowsConsoleObserver'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  const pty = { pid: 42, resize: vi.fn() }
  const observer = {
    ensureReady: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue({ cols: 120, rows: 40 }),
  }
  const owner = new WindowsPtyResizeOwner(pty, observer, {
    startupTimeoutMs: 100,
    timeoutMs: 100,
    pollIntervalMs: 5,
  })
  return { pty, observer, owner }
}

describe('Windows PTY resize owner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('confirms a cold session when first data and observer startup exceed the old resize budget', async () => {
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      disconnect: vi.fn(),
      kill: vi.fn(),
      send: vi.fn((request: { requestId: number }) => {
        child.emit('message', {
          type: 'geometry',
          requestId: request.requestId,
          geometry: { cols: 120, rows: 40 },
        })
      }),
    })
    const start = vi.fn(() => {
      setTimeout(() => child.emit('message', { type: 'ready' }), 1_600)
      return child as unknown as ChildProcess
    })
    const observer = new WindowsConsoleGeometryObserver(start)
    const pty = { pid: 42, resize: vi.fn() }
    const owner = new WindowsPtyResizeOwner(pty, observer)
    const result = owner.resize(120, 40).catch(error => error)
    setTimeout(() => owner.markReady(), 800)
    try {
      await vi.advanceTimersByTimeAsync(2_400)
      await expect(result).resolves.toEqual({ status: 'applied_verified', cols: 120, rows: 40 })
      expect(start).toHaveBeenCalledOnce()
      expect(pty.resize).toHaveBeenCalledExactlyOnceWith(120, 40)
    } finally {
      owner.dispose()
      observer.dispose()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('prewarms the observer before a session needs its first resize', async () => {
    const { observer, owner, pty } = fixture()
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(observer.ensureReady).toHaveBeenCalledOnce()
      expect(pty.resize).not.toHaveBeenCalled()
      expect(observer.read).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
    }
  })

  it('waits for readiness and actual Console geometry, ignoring the request cache', async () => {
    const { pty, observer, owner } = fixture()
    observer.read.mockResolvedValueOnce({ cols: 80, rows: 24 })
    const result = owner.resize(120, 40)
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).not.toHaveBeenCalled()
    owner.markReady()
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).toHaveBeenCalledWith(120, 40)
    await vi.advanceTimersByTimeAsync(5)
    await expect(result).resolves.toEqual({ status: 'applied_verified', cols: 120, rows: 40 })
    expect(observer.read).toHaveBeenCalledTimes(2)
    owner.dispose()
  })

  it('never defers a native mutation past a readiness timeout', async () => {
    const { pty, owner } = fixture()
    const result = expect(owner.resize(120, 40)).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(100)
    await result
    owner.markReady()
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).not.toHaveBeenCalled()
    owner.dispose()
  })

  it('bounds a never-ready observer and discards its late readiness', async () => {
    const { pty, observer, owner } = fixture()
    const ready = deferred<void>()
    observer.ensureReady.mockReturnValue(ready.promise)
    owner.markReady()
    const result = expect(owner.resize(120, 40)).rejects.toThrow(/startup timed out/)
    await vi.advanceTimersByTimeAsync(100)
    await result
    ready.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).not.toHaveBeenCalled()
    owner.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts the unchanged confirmation deadline only after readiness', async () => {
    const { pty, observer, owner } = fixture()
    observer.read.mockResolvedValue({ cols: 80, rows: 24 })
    let settled = false
    const result = owner.resize(120, 40).catch(error => {
      settled = true
      return error
    })
    await vi.advanceTimersByTimeAsync(90)
    owner.markReady()
    await vi.advanceTimersByTimeAsync(99)
    expect(pty.resize).toHaveBeenCalledExactlyOnceWith(120, 40)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(
      new Error('[pty-host] Windows Console geometry confirmation timed out'),
    )
    owner.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expires queued work without a late mutation after the preceding confirmation', async () => {
    const pty = { pid: 42, resize: vi.fn() }
    const read = deferred<{ cols: number; rows: number }>()
    const owner = new WindowsPtyResizeOwner(
      pty,
      { ensureReady: async () => undefined, read: () => read.promise },
      { startupTimeoutMs: 50, timeoutMs: 100, pollIntervalMs: 5 },
    )
    owner.markReady()
    const first = owner.resize(120, 40)
    const queued = expect(owner.resize(60, 18)).rejects.toThrow(/startup timed out/)
    await vi.advanceTimersByTimeAsync(50)
    await queued
    read.resolve({ cols: 120, rows: 40 })
    await expect(first).resolves.toMatchObject({ cols: 120, rows: 40 })
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).toHaveBeenCalledExactlyOnceWith(120, 40)
    owner.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an unconfirmed resize and allows an explicit retry', async () => {
    const { pty, observer, owner } = fixture()
    owner.markReady()
    observer.read.mockResolvedValue({ cols: 80, rows: 24 })
    const result = expect(owner.resize(120, 40)).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(100)
    await result
    observer.read.mockResolvedValue({ cols: 60, rows: 18 })
    await expect(owner.resize(60, 18)).resolves.toMatchObject({ cols: 60, rows: 18 })
    expect(pty.resize).toHaveBeenCalledTimes(2)
    owner.dispose()
  })

  it('serializes same-session mutations until the previous readback finishes', async () => {
    const { pty, observer, owner } = fixture()
    owner.markReady()
    const firstRead = deferred<{ cols: number; rows: number }>()
    observer.read.mockReturnValueOnce(firstRead.promise).mockResolvedValue({ cols: 60, rows: 18 })
    const first = owner.resize(120, 40)
    const second = owner.resize(60, 18)
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize.mock.calls).toEqual([[120, 40]])
    firstRead.resolve({ cols: 120, rows: 40 })
    await expect(first).resolves.toMatchObject({ cols: 120, rows: 40 })
    await expect(second).resolves.toMatchObject({ cols: 60, rows: 18 })
    expect(pty.resize.mock.calls).toEqual([
      [120, 40],
      [60, 18],
    ])
    owner.dispose()
  })

  it('cancels pending and queued requests immediately on exit and discards late results', async () => {
    const { pty, observer, owner } = fixture()
    owner.markReady()
    const read = deferred<{ cols: number; rows: number }>()
    observer.read.mockReturnValue(read.promise)
    const first = expect(owner.resize(120, 40)).rejects.toThrow(/closed/)
    const queued = expect(owner.resize(60, 18)).rejects.toThrow(/closed/)
    await vi.advanceTimersByTimeAsync(0)
    owner.dispose()
    await Promise.all([first, queued])
    read.resolve({ cols: 120, rows: 40 })
    await vi.advanceTimersByTimeAsync(0)
    expect(pty.resize).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await expect(owner.resize(80, 24)).rejects.toThrow(/closed/)
  })

  it('recovers once from an observer failure without issuing another native resize', async () => {
    const { pty, observer, owner } = fixture()
    owner.markReady()
    observer.read.mockRejectedValueOnce(new Error('observer exited'))
    await expect(owner.resize(120, 40)).resolves.toMatchObject({ cols: 120, rows: 40 })
    expect(pty.resize).toHaveBeenCalledTimes(1)
    expect(observer.ensureReady).toHaveBeenCalledTimes(3)
    owner.dispose()
  })
})
