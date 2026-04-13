import { describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

function createMockApp() {
  const listeners = new Map<string, Listener[]>()

  return {
    isPackaged: false,
    whenReady: vi.fn(() => Promise.resolve()),
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

describe('main process lifecycle', () => {
  it('quits on window-all-closed during tests', async () => {
    vi.resetModules()

    const app = createMockApp()
    const dispose = vi.fn()

    class BrowserWindow {
      public static windows: BrowserWindow[] = []

      public static getAllWindows(): BrowserWindow[] {
        return BrowserWindow.windows
      }

      public webContents = {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
      }

      public constructor() {
        BrowserWindow.windows.push(this)
      }

      public on(): void {}
      public show(): void {}
      public loadURL(): void {}
      public loadFile(): void {}
    }

    vi.doMock('electron', () => ({
      app,
      shell: {
        openExternal: vi.fn(),
      },
      BrowserWindow,
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

    vi.doMock('../../../src/app/main/controlSurface/registerControlSurfaceServer', () => ({
      registerControlSurfaceServer: () => ({
        dispose: vi.fn(),
      }),
    }))

    vi.doMock('../../../src/app/main/worker/localWorkerManager', () => ({
      hasOwnedLocalWorkerProcess: () => false,
      startLocalWorker: vi.fn(async () => ({ status: 'stopped', connection: null })),
      stopOwnedLocalWorker: vi.fn(async () => true),
    }))

    await import('../../../src/app/main/index')
    await Promise.resolve()

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
})
