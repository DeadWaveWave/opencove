import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

function createMockApp() {
  const listeners = new Map<string, Listener[]>()
  let startup = Promise.resolve()

  return {
    isPackaged: false,
    whenReady: vi.fn(() => ({
      then: (start: () => Promise<void>) => {
        startup = Promise.resolve().then(start)
        // Awaited by the test; prevent an unhandled rejection before import completes.
        void startup.catch(() => undefined)
        return startup
      },
    })),
    waitForStartup: () => startup,
    getPath: vi.fn((_name: string) => '/tmp/opencove-test-userdata'),
    setPath: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    on: vi.fn((event: string, listener: Listener) => {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
      return undefined
    }),
    emit(event: string, ...args: unknown[]) {
      const handlers = listeners.get(event) ?? []
      handlers.forEach(handler => handler(...args))
    },
    quit: vi.fn(),
  }
}

async function createLifecycleHarness() {
  vi.resetModules()

  const app = createMockApp()
  const dispose = vi.fn()

  class BrowserWindow extends EventEmitter {
    public static windows: BrowserWindow[] = []

    public static getAllWindows(): BrowserWindow[] {
      return BrowserWindow.windows
    }

    public webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    private destroyed = false
    public isDestroyed(): boolean {
      return this.destroyed
    }
    public close(): void {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
      }
      this.emit('close', event)
      if (!event.defaultPrevented) {
        this.webContents.emit('destroyed')
      }
    }
    // Keep native destruction separate from renderer teardown, as Electron does.
    public finishClose(): void {
      this.destroyed = true
      BrowserWindow.windows = BrowserWindow.windows.filter(window => window !== this)
      this.emit('closed')
    }

    public constructor() {
      super()
      BrowserWindow.windows.push(this)
    }

    public show(): void {}
    public setContentSize(): void {}
    public loadURL(): void {}
    public loadFile(): void {}
  }

  vi.doMock('electron', () => ({
    app: { ...app, removeListener: vi.fn() },
    shell: {
      openExternal: vi.fn(),
    },
    BrowserWindow,
    webContents: { getAllWebContents: () => [] },
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn(template => template),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({})),
    },
  }))

  vi.doMock('@electron-toolkit/utils', () => ({
    electronApp: {
      setAppUserModelId: vi.fn(),
    },
    optimizer: {
      watchWindowShortcuts: vi.fn(),
    },
    is: {
      dev: false,
    },
  }))

  vi.doMock('../../../src/app/main/ipc/registerIpcHandlers', () => ({
    registerIpcHandlers: () => ({ dispose }),
  }))

  vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/runtime', () => ({
    createPtyRuntime: () => ({
      dispose: vi.fn(),
    }),
  }))

  vi.doMock('../../../src/app/main/worker/localWorkerManager', () => ({
    beginLocalWorkerShutdown: vi.fn(),
    hasOwnedLocalWorkerProcess: () => false,
    startLocalWorker: vi.fn(async () => ({ status: 'stopped', connection: null })),
    stopOwnedLocalWorker: vi.fn(async () => true),
  }))

  vi.doMock('../../../src/app/main/worker/resolveHomeWorkerEndpoint', () => ({
    resolveHomeWorkerEndpoint: vi.fn(async () => ({
      effectiveMode: 'local',
      config: null,
      diagnostics: [],
    })),
  }))

  vi.doMock('../../../src/app/main/worker/homeWorkerEndpointResolver', () => ({
    createHomeWorkerEndpointResolver: vi.fn(() => async () => ({
      hostname: '127.0.0.1',
      port: 43123,
      token: 'test-token',
    })),
  }))

  vi.doMock(
    '../../../src/contexts/agent/infrastructure/cleanupLegacyManagedHooksAtStartup',
    () => ({
      cleanupLegacyManagedHooksAtStartup: vi.fn(async () => ({
        removedCount: 0,
        failures: [],
      })),
      reportLegacyManagedHookCleanupFailures: vi.fn(),
    }),
  )

  let finishFlush!: () => void
  const flush = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finishFlush = resolve
      }),
  )
  vi.doMock('../../../src/app/main/rendererPersistFlush', () => ({
    requestRendererPersistFlush: flush,
  }))

  await import('../../../src/app/main/index')
  await app.waitForStartup()

  return { app, BrowserWindow, dispose, flush, finishFlush: () => finishFlush() }
}

describe('main process lifecycle', () => {
  it('quits on window-all-closed during tests', async () => {
    const { app, dispose } = await createLifecycleHarness()
    app.emit('window-all-closed')

    if (process.env['NODE_ENV'] === 'test' || process.platform !== 'darwin') {
      expect(dispose).not.toHaveBeenCalled()
      expect(app.quit).toHaveBeenCalledTimes(1)
    } else {
      expect(dispose).not.toHaveBeenCalled()
      expect(app.quit).not.toHaveBeenCalled()
    }

    app.emit('before-quit')
    expect(dispose).not.toHaveBeenCalled()

    app.emit('will-quit')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['flush', 'renderer teardown'] as const)(
    'retains activation during %s until native close, creating one replacement',
    async phase => {
      const { app, BrowserWindow, flush, finishFlush } = await createLifecycleHarness()
      const closing = BrowserWindow.windows[0]
      closing.close()
      expect(flush).toHaveBeenCalledTimes(1)
      if (phase === 'renderer teardown') {
        const tornDown = new Promise<void>(resolve =>
          closing.webContents.once('destroyed', resolve),
        )
        finishFlush()
        await tornDown
      }
      app.emit('activate')
      app.emit('activate')
      expect(BrowserWindow.windows).toEqual([closing])
      if (phase === 'flush') {
        const tornDown = new Promise<void>(resolve =>
          closing.webContents.once('destroyed', resolve),
        )
        finishFlush()
        await tornDown
      }
      expect(BrowserWindow.windows).toEqual([closing])
      closing.finishClose()
      expect(BrowserWindow.windows).toHaveLength(1)
      expect(BrowserWindow.windows[0]).not.toBe(closing)
      app.emit('activate')
      expect(BrowserWindow.windows).toHaveLength(1)
      // Consuming the request must not reopen a later ordinary close.
      BrowserWindow.windows[0].finishClose()
      expect(BrowserWindow.windows).toHaveLength(0)
    },
  )

  it('does not turn activation of an existing window into a later reopen', async () => {
    const { app, BrowserWindow } = await createLifecycleHarness()
    const window = BrowserWindow.windows[0]
    // Visibility and focus are not evidence that a window is closing.
    app.emit('activate')
    expect(BrowserWindow.windows).toEqual([window])
    window.finishClose()
    expect(BrowserWindow.windows).toHaveLength(0)
    app.emit('activate')
    expect(BrowserWindow.windows).toHaveLength(1)
  })

  it('discards pending activation when quitting starts', async () => {
    const { app, BrowserWindow, finishFlush } = await createLifecycleHarness()
    const closing = BrowserWindow.windows[0]
    closing.close()
    app.emit('activate')
    app.emit('before-quit')
    const tornDown = new Promise<void>(resolve => closing.webContents.once('destroyed', resolve))
    finishFlush()
    await tornDown
    closing.finishClose()
    app.emit('activate')
    expect(BrowserWindow.windows).toHaveLength(0)
  })
})
