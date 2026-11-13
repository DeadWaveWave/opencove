import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import {
  createRendererFailureContext,
  getProcessFailureContext,
} from '../../../src/app/main/processFailureDiagnostics'

const electron = vi.hoisted(() => ({ getAppMetrics: vi.fn(), getGPUFeatureStatus: vi.fn() }))
vi.mock('electron', () => ({ app: electron }))

describe('process failure context', () => {
  it('keeps exit diagnostics usable when Chromium metrics are unavailable', () => {
    electron.getAppMetrics.mockImplementation(() => {
      throw new Error('unavailable')
    })
    electron.getGPUFeatureStatus.mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(getProcessFailureContext()).toMatchObject({
      platform: process.platform,
      processMetricsAtExit: null,
      gpuFeatureStatus: null,
      systemFreeMemoryBytes: expect.any(Number),
    })
  })

  it('records reload state and the last live renderer PID without querying the dead renderer', () => {
    const contents = Object.assign(new EventEmitter(), {
      id: 3,
      getOSProcessId: vi.fn().mockReturnValue(123),
      isLoading: vi.fn().mockReturnValue(true),
      isDestroyed: vi.fn().mockReturnValue(false),
    })
    const window = {
      webContents: contents,
      isDestroyed: () => false,
      isVisible: () => false,
      isFocused: () => false,
    } as unknown as BrowserWindow
    const context = createRendererFailureContext(window)
    contents.emit('dom-ready')
    contents.emit('did-finish-load')
    contents.emit('did-start-loading')
    contents.getOSProcessId.mockImplementation(() => {
      throw new Error('dead renderer')
    })
    expect(context()).toMatchObject({
      webContentsId: 3,
      rendererPid: 123,
      lastLifecycleEvent: 'did-start-loading',
      completedLoads: 1,
      windowVisible: false,
      windowFocused: false,
    })
    contents.emit('destroyed')
    expect(contents.listenerCount('dom-ready')).toBe(0)
  })
})
