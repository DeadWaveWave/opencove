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
  }
}

describe('main process Wayland IME flags', () => {
  it('enables the Chromium Wayland IME switch on Linux Wayland sessions', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env['NODE_ENV']
    const previousSessionType = process.env['XDG_SESSION_TYPE']
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

    process.env['NODE_ENV'] = 'production'
    process.env['XDG_SESSION_TYPE'] = 'wayland'
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })

    try {
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
        public showInactive(): void {}
        public loadURL(): void {}
        public loadFile(): void {}
      }

      vi.doMock('electron', () => ({
        app,
        shell: {
          openExternal: vi.fn(),
        },
        BrowserWindow,
        nativeImage: {
          createFromPath: vi.fn(),
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

      expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('enable-wayland-ime')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV']
      } else {
        process.env['NODE_ENV'] = previousNodeEnv
      }

      if (previousSessionType === undefined) {
        delete process.env['XDG_SESSION_TYPE']
      } else {
        process.env['XDG_SESSION_TYPE'] = previousSessionType
      }

      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }
  })
})
