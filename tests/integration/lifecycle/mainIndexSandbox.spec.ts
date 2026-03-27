import { describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

function createMockApp() {
  const listeners = new Map<string, Listener[]>()

  return {
    whenReady: vi.fn(() => Promise.resolve()),
    getPath: vi.fn((_name: string) => '/tmp/opencove-test-userdata'),
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

describe('main process sandbox flags', () => {
  it('disables the Chromium sandbox for Linux CI E2E launches when requested', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env['NODE_ENV']
    const previousCi = process.env['CI']
    const previousDisableSandbox = process.env['ELECTRON_DISABLE_SANDBOX']
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

    process.env['NODE_ENV'] = 'test'
    process.env['CI'] = 'true'
    process.env['ELECTRON_DISABLE_SANDBOX'] = '1'
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

      await import('../../../src/app/main/index')
      await Promise.resolve()

      expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('no-sandbox')
      expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-dev-shm-usage')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV']
      } else {
        process.env['NODE_ENV'] = previousNodeEnv
      }

      if (previousCi === undefined) {
        delete process.env['CI']
      } else {
        process.env['CI'] = previousCi
      }

      if (previousDisableSandbox === undefined) {
        delete process.env['ELECTRON_DISABLE_SANDBOX']
      } else {
        process.env['ELECTRON_DISABLE_SANDBOX'] = previousDisableSandbox
      }

      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }
  })
})
