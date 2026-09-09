import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { installProbes } from '../../../scripts/lib/canvas-window-profile-probes.mjs'

describe('serialized canvas performance probes', () => {
  it('installs, samples and cleans up in fresh Main/renderer contexts without runner closures', async () => {
    let now = 0
    let mainTick: () => void = () => {}
    let rendererFrame: (time: number) => void = () => {}
    const nativeWindow = new EventEmitter()
    const clearInterval = vi.fn()
    const cancelAnimationFrame = vi.fn()
    const removeEventListener = vi.fn()
    const mainContext = {
      performance: { now: () => now, timeOrigin: 1_000 },
      setInterval: (callback: () => void) => {
        mainTick = callback
        return 1
      },
      clearInterval,
      electron: {
        app: { getAppMetrics: () => [{ pid: 5, type: 'Browser', cpu: { percentCPUUsage: 2 } }] },
        BrowserWindow: { getAllWindows: () => [nativeWindow] },
      },
    }
    const rendererContext = {
      performance: { now: () => now, timeOrigin: 2_000, mark: vi.fn() },
      document: { visibilityState: 'visible', hasFocus: () => true },
      window: { addEventListener: vi.fn(), removeEventListener },
      requestAnimationFrame: (callback: (time: number) => void) => {
        rendererFrame = callback
        return 2
      },
      cancelAnimationFrame,
      PerformanceObserver: { supportedEntryTypes: [] },
    }
    await installProbes(
      {
        evaluate: (callback: Function) =>
          runInNewContext(`(${callback.toString()})(electron)`, mainContext),
      },
      {
        evaluate: (callback: Function) =>
          runInNewContext(`(${callback.toString()})()`, rendererContext),
      },
    )
    now = 300
    mainTick()
    rendererFrame(300)
    nativeWindow.emit('blur')
    const main = runInNewContext('globalThis.__opencoveStallMain.stop()', mainContext)
    const renderer = runInNewContext('window.__opencoveStallRenderer.stop()', rendererContext)
    expect(main.samples[0]).toMatchObject({ at: 300, timerDelayMs: 50 })
    expect(main.events[0]).toMatchObject({ name: 'blur' })
    expect(renderer.frames[0]).toMatchObject({ deltaMs: 300, focused: true })
    expect(clearInterval).toHaveBeenCalledWith(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(2)
    expect(nativeWindow.eventNames()).toEqual([])
    expect(removeEventListener).toHaveBeenCalledTimes(5)
  })
})
