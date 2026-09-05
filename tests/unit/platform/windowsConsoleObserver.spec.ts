// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { WindowsConsoleGeometryObserver } from '@platform/process/ptyHost/windowsConsoleObserver'
import {
  isWindowsConsoleRequest,
  isWindowsConsoleResponse,
} from '@platform/process/ptyHost/windowsConsoleProtocol'

function child() {
  return Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn(),
    disconnect: vi.fn(),
    kill: vi.fn(),
  })
}

describe('Windows Console observer transport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shares startup and routes interleaved replies to the correct session query', async () => {
    const process = child()
    const start = vi.fn(() => process as unknown as ChildProcess)
    const observer = new WindowsConsoleGeometryObserver(start)
    const signal = new AbortController().signal
    const first = observer.read(41, signal)
    const second = observer.read(42, signal)
    expect(start).toHaveBeenCalledTimes(1)
    process.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(process.send.mock.calls.map(([message]) => message.pid)).toEqual([41, 42])
    process.emit('message', { type: 'geometry', requestId: 2, geometry: { cols: 60, rows: 18 } })
    process.emit('message', { type: 'geometry', requestId: 1, geometry: { cols: 120, rows: 40 } })
    await expect(first).resolves.toEqual({ cols: 120, rows: 40 })
    await expect(second).resolves.toEqual({ cols: 60, rows: 18 })
    observer.dispose()
    expect(process.kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels one query without terminating other sessions or accepting its late reply', async () => {
    const process = child()
    const observer = new WindowsConsoleGeometryObserver(() => process as unknown as ChildProcess)
    const cancellation = new AbortController()
    const first = expect(observer.read(41, cancellation.signal)).rejects.toThrow('session closed')
    const second = observer.read(42, new AbortController().signal)
    process.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    cancellation.abort(new Error('session closed'))
    await first
    process.emit('message', { type: 'geometry', requestId: 1, geometry: { cols: 99, rows: 99 } })
    process.emit('message', { type: 'geometry', requestId: 2, geometry: { cols: 60, rows: 18 } })
    await expect(second).resolves.toEqual({ cols: 60, rows: 18 })
    expect(process.kill).not.toHaveBeenCalled()
    observer.dispose()
  })

  it('bounds a hung query, restarts on demand and ignores messages from the old process', async () => {
    const old = child()
    const replacement = child()
    const start = vi.fn().mockReturnValueOnce(old).mockReturnValue(replacement)
    const observer = new WindowsConsoleGeometryObserver(start)
    const signal = new AbortController().signal
    const first = expect(observer.read(41, signal)).rejects.toThrow(/timed out/)
    old.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(500)
    await first
    expect(old.kill).toHaveBeenCalledOnce()
    const next = observer.read(42, signal)
    replacement.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    old.emit('message', { type: 'geometry', requestId: 2, geometry: { cols: 99, rows: 99 } })
    replacement.emit('message', {
      type: 'geometry',
      requestId: 2,
      geometry: { cols: 60, rows: 18 },
    })
    await expect(next).resolves.toEqual({ cols: 60, rows: 18 })
    observer.dispose()
  })

  it.each(['error', 'exit', 'invalid', 'unavailable', 'send'])(
    'rejects %s without leaking requests',
    async failure => {
      const process = child()
      if (failure === 'send') {
        process.send.mockImplementation(() => {
          throw new Error('send failed')
        })
      }
      const observer = new WindowsConsoleGeometryObserver(() => process as unknown as ChildProcess)
      const pending = expect(observer.read(41, new AbortController().signal)).rejects.toThrow()
      if (failure === 'unavailable') {
        process.emit('message', { type: 'unavailable', error: 'native capability missing' })
      } else {
        process.emit('message', { type: 'ready' })
        await vi.advanceTimersByTimeAsync(0)
        if (failure === 'error') {
          process.emit('error', new Error('child failed'))
        }
        if (failure === 'exit') {
          process.emit('exit', 1)
        }
        if (failure === 'invalid') {
          process.emit('message', {
            type: 'geometry',
            requestId: 1,
            geometry: { cols: 0, rows: 24 },
          })
        }
      }
      await pending
      observer.dispose()
      expect(process.kill).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('bounds startup and prevents restarting after host disposal', async () => {
    const process = child()
    const observer = new WindowsConsoleGeometryObserver(() => process as unknown as ChildProcess)
    const signal = new AbortController().signal
    const ready = expect(observer.ensureReady(signal)).rejects.toThrow(/startup timed out/)
    await vi.advanceTimersByTimeAsync(1_500)
    await ready
    observer.dispose()
    await expect(observer.ensureReady(signal)).rejects.toThrow(/disposed/)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Windows Console private protocol', () => {
  it('rejects invalid PIDs, IDs, dimensions and extra fields', () => {
    const request = { type: 'read', requestId: 1, pid: 42 }
    expect(isWindowsConsoleRequest(request)).toBe(true)
    for (const pid of [-1, 0, 1.5, 0xffffffff, '42', NaN]) {
      expect(isWindowsConsoleRequest({ ...request, pid })).toBe(false)
    }
    expect(isWindowsConsoleRequest({ ...request, requestId: 0 })).toBe(false)
    expect(isWindowsConsoleRequest({ ...request, cols: 80 })).toBe(false)
    expect(
      isWindowsConsoleResponse({
        type: 'geometry',
        requestId: 1,
        geometry: { cols: 80, rows: 24 },
      }),
    ).toBe(true)
    expect(
      isWindowsConsoleResponse({
        type: 'geometry',
        requestId: 1,
        geometry: { cols: 32_768, rows: 24 },
      }),
    ).toBe(false)
    expect(isWindowsConsoleResponse({ type: 'ready', pid: 42 })).toBe(false)
    expect(isWindowsConsoleResponse({ type: 'unavailable', error: '' })).toBe(false)
  })
})
