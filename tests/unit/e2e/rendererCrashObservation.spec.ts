import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import type { ElectronApplication } from '@playwright/test'
import { runInNewContext } from 'node:vm'
import {
  createRendererRecoveryProbe,
  readElectronMainProcessPid,
  withRecoveryDeadline,
} from '../../e2e/runtime-diagnostics.renderer-crash.helpers'

afterEach(() => vi.useRealTimers())

it('uses the Electron main PID when Playwright owns a different Windows launcher PID', async () => {
  // Playwright 1.58 launches Electron with shell:true on Windows. The callback
  // runs in Electron's context, with neither the launcher nor the test runner PID.
  const app = {
    process: vi.fn(() => ({ pid: 7172 })),
    evaluate: vi.fn(async (callback: () => number) =>
      runInNewContext(`(${callback.toString()})()`, { process: { pid: 6956 } }),
    ),
  }
  expect(await readElectronMainProcessPid(app as unknown as ElectronApplication)).toBe(6956)
  expect(app.process).not.toHaveBeenCalled()
})

it('reports the recovery stage when a native evaluation never settles', async () => {
  vi.useFakeTimers()
  let outcome = 'pending'
  const operation = new Promise<void>(() => undefined)
  void withRecoveryDeadline('renderer death', operation, 50).catch(error => {
    outcome = error.message
  })
  await vi.advanceTimersByTimeAsync(50)
  expect(outcome).toBe('renderer death exceeded 50ms')
  expect(vi.getTimerCount()).toBe(0)
})

it('clears its deadline on success and preserves native errors', async () => {
  vi.useFakeTimers()
  await expect(withRecoveryDeadline('ready', Promise.resolve('ready'), 50)).resolves.toBe('ready')
  const error = new Error('native host exited')
  await expect(withRecoveryDeadline('snapshot', Promise.reject(error), 50)).rejects.toBe(error)
  expect(vi.getTimerCount()).toBe(0)
})

it('returns from crash injection without a death or load event and retains the lifecycle later', () => {
  const contents = Object.assign(new EventEmitter(), {
    getOSProcessId: vi.fn().mockReturnValue(123),
    isDestroyed: () => false,
    isCrashed: vi.fn().mockReturnValue(false),
    isLoading: vi.fn().mockReturnValue(false),
    getLastWebPreferences: () => ({ sandbox: false }),
    forcefullyCrashRenderer: vi.fn(),
  })
  const host = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow
  const probe = createRendererRecoveryProbe(host)
  expect(probe.trigger()).toBeUndefined()
  expect(contents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1)
  expect(probe.snapshot()).toMatchObject({
    initialRendererPid: 123,
    gone: null,
    finishedLoads: 0,
    events: [{ event: 'crash-requested' }, { event: 'crash-call-returned' }],
  })
  contents.isCrashed.mockReturnValue(true)
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })
  contents.isLoading.mockReturnValue(true)
  contents.emit('did-start-loading')
  // A reload can start without ever finishing. Keep both facts for the timeout report.
  expect(probe.snapshot()).toMatchObject({
    gone: { reason: 'crashed', exitCode: 133 },
    loading: true,
    finishedLoads: 0,
  })
  contents.emit('did-fail-load', {}, -2, 'load failed')
  expect(probe.snapshot().loadFailure).toEqual({ code: -2, description: 'load failed' })
  contents.getOSProcessId.mockReturnValue(456)
  contents.isCrashed.mockReturnValue(false)
  contents.isLoading.mockReturnValue(false)
  contents.emit('did-finish-load')
  contents.emit('did-stop-loading')
  expect(probe.snapshot()).toMatchObject({ rendererPid: 456, crashed: false, finishedLoads: 1 })
  probe.dispose()
  expect(contents.eventNames()).toEqual([])
})
