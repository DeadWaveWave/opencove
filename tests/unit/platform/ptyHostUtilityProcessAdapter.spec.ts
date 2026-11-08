// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { UtilityProcess } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { createElectronUtilityPtyHostProcess } from '@platform/process/ptyHost/electronUtilityProcessAdapter'

afterEach(() => vi.restoreAllMocks())
it.skipIf(process.platform === 'win32')(
  'preserves UtilityProcess TERM and forces SIGKILL only on the captured live child',
  () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 12345,
      kill: vi.fn(() => true),
      stdout: null,
      stderr: null,
    })
    const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
    const adapter = createElectronUtilityPtyHostProcess(child as unknown as UtilityProcess)
    adapter.kill('SIGTERM')
    expect(child.kill).toHaveBeenCalledOnce()
    adapter.kill('SIGKILL')
    expect(signal).toHaveBeenCalledExactlyOnceWith(12345, 'SIGKILL')
    child.emit('exit', 0)
    adapter.kill('SIGKILL')
    expect(signal).toHaveBeenCalledOnce()
  },
)

it.skipIf(process.platform === 'win32')(
  'captures an initially undefined PID on spawn before retirement SIGKILL',
  async () => {
    vi.useFakeTimers()
    try {
      const child = Object.assign(new EventEmitter(), {
        pid: undefined as number | undefined,
        kill: vi.fn(() => true),
        stdout: null,
        stderr: null,
      })
      const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
      const adapter = createElectronUtilityPtyHostProcess(child as unknown as UtilityProcess)
      expect(adapter.kill('SIGKILL')).toBe(false)
      child.pid = 12345
      child.emit('spawn')
      expect(adapter.pid).toBe(12345)
      const { retirePtyHostProcess } = await import('@platform/process/ptyHost/retireProcess')
      const retirement = retirePtyHostProcess(adapter, 'host', vi.fn())
      await vi.advanceTimersByTimeAsync(4_000)
      expect(signal).toHaveBeenCalledExactlyOnceWith(12345, 'SIGKILL')
      child.pid = 54321
      expect(adapter.kill('SIGKILL')).toBe(false)
      child.emit('exit', 0)
      await retirement
      expect(adapter.kill('SIGKILL')).toBe(false)
      expect(signal).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  },
)
