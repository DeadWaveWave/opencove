// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { prepareIdleWebsiteSnapshot } from '../../e2e/workspace-canvas.website-window.freeze.helpers'

vi.mock('@playwright/test', async () => ({ expect: (await import('vitest')).expect }))

function fixture() {
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => false,
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue(undefined),
  })
  const runtime = {
    view: {
      webContents: {
        debugger: debuggerApi,
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      },
    },
    snapshotDataUrl: 'startup-snapshot' as string | null,
    snapshotCaptureInFlight: false,
  }
  const electron = {
    BrowserWindow: {
      getAllWindows: () => [
        {
          __opencoveWebsiteWindowManager: {
            runtimeByNodeId: new Map([['website-freeze-node', runtime]]),
          },
        },
      ],
    },
  }
  const electronApp = {
    evaluate: async (callback: (api: typeof electron) => unknown) => callback(electron),
  } as unknown as ElectronApplication
  const paint = () => debuggerApi.emit('message', {}, 'LayerTree.layerPainted')
  return { electronApp, debuggerApi, runtime, paint }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('website freeze idle observer', () => {
  it('accepts a completed quiet timer when the wall clock reads 4999 ms', async () => {
    const h = fixture()
    const observation = prepareIdleWebsiteSnapshot(h.electronApp)
    const result = observation.catch(error => error)
    h.paint()

    await vi.advanceTimersByTimeAsync(4_999)
    expect(h.runtime.snapshotDataUrl).toBe('startup-snapshot')
    // Timer time advances 5000 ms while Date.now advances only 4999 ms.
    vi.setSystemTime(Date.now() - 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBeUndefined()

    expect(h.runtime.snapshotDataUrl).toBeNull()
    expect(h.debuggerApi.listenerCount('message')).toBe(0)
    expect(h.debuggerApi.detach).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts the entire quiet window on every paint before clearing the cached snapshot', async () => {
    const h = fixture()
    let finished = false
    const observation = prepareIdleWebsiteSnapshot(h.electronApp).then(() => {
      finished = true
    })
    h.paint()
    await vi.advanceTimersByTimeAsync(4_999)
    h.paint()
    await vi.advanceTimersByTimeAsync(4_999)

    expect(finished).toBe(false)
    expect(h.runtime.snapshotDataUrl).toBe('startup-snapshot')
    await vi.advanceTimersByTimeAsync(1)
    await observation
    expect(finished).toBe(true)
    expect(h.runtime.snapshotDataUrl).toBeNull()
  })

  it('requires a positive paint observation and cleans up on the deadline', async () => {
    const h = fixture()
    const observation = prepareIdleWebsiteSnapshot(h.electronApp)
    const result = expect(observation).rejects.toThrow('Website did not become idle')
    await vi.advanceTimersByTimeAsync(15_000)
    await result

    expect(h.runtime.snapshotDataUrl).toBe('startup-snapshot')
    expect(h.debuggerApi.listenerCount('message')).toBe(0)
    expect(h.debuggerApi.sendCommand).toHaveBeenLastCalledWith('LayerTree.disable')
    expect(h.debuggerApi.detach).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
