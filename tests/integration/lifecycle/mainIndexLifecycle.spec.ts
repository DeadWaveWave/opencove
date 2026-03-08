import { describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

function createMockApp() {
  const listeners = new Map<string, Listener[]>()

  return {
    whenReady: vi.fn(() => Promise.resolve()),
    getPath: vi.fn((_name: string) => '/tmp/cove-test-userdata'),
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

  it('shows window without focusing during E2E no-focus mode', async () => {
    vi.resetModules()

    const previousNoFocus = process.env['COVE_E2E_NO_FOCUS']
    const previousWindowMode = process.env['COVE_E2E_WINDOW_MODE']
    const previousNodeEnv = process.env['NODE_ENV']
    process.env['COVE_E2E_NO_FOCUS'] = '1'
    process.env['NODE_ENV'] = 'test'

    try {
      const app = createMockApp()
      const dispose = vi.fn()

      class BrowserWindow {
        public static windows: BrowserWindow[] = []
        public static constructorOptions: Array<Record<string, unknown>> = []

        private readonly listeners = new Map<string, Listener[]>()

        public static getAllWindows(): BrowserWindow[] {
          return BrowserWindow.windows
        }

        public webContents = {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn(),
        }

        public show = vi.fn()
        public showInactive = vi.fn()

        public constructor(options: Record<string, unknown>) {
          BrowserWindow.windows.push(this)
          BrowserWindow.constructorOptions.push(options)
        }

        public on(event: string, listener: Listener): void {
          const existing = this.listeners.get(event) ?? []
          existing.push(listener)
          this.listeners.set(event, existing)
        }

        public emit(event: string, ...args: unknown[]): void {
          const handlers = this.listeners.get(event) ?? []
          handlers.forEach(handler => handler(...args))
        }

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

      const mainWindow = BrowserWindow.windows[0]
      expect(mainWindow).toBeDefined()
      mainWindow.emit('ready-to-show')

      expect(mainWindow.showInactive).toHaveBeenCalledTimes(1)
      expect(mainWindow.show).not.toHaveBeenCalled()

      const firstWindowOptions = BrowserWindow.constructorOptions[0]
      const webPreferences = firstWindowOptions['webPreferences'] as {
        backgroundThrottling?: boolean
      }
      expect(webPreferences.backgroundThrottling).toBe(false)

      app.emit('before-quit')
      expect(dispose).not.toHaveBeenCalled()

      app.emit('will-quit')
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      if (previousNoFocus === undefined) {
        delete process.env['COVE_E2E_NO_FOCUS']
      } else {
        process.env['COVE_E2E_NO_FOCUS'] = previousNoFocus
      }

      if (previousWindowMode === undefined) {
        delete process.env['COVE_E2E_WINDOW_MODE']
      } else {
        process.env['COVE_E2E_WINDOW_MODE'] = previousWindowMode
      }

      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV']
      } else {
        process.env['NODE_ENV'] = previousNodeEnv
      }
    }
  })

  it('keeps E2E window hidden for visual regression mode', async () => {
    vi.resetModules()

    const previousNoFocus = process.env['COVE_E2E_NO_FOCUS']
    const previousWindowMode = process.env['COVE_E2E_WINDOW_MODE']
    const previousNodeEnv = process.env['NODE_ENV']
    delete process.env['COVE_E2E_NO_FOCUS']
    process.env['COVE_E2E_WINDOW_MODE'] = 'hidden'
    process.env['NODE_ENV'] = 'test'

    try {
      const app = createMockApp()
      const dispose = vi.fn()

      class BrowserWindow {
        public static windows: BrowserWindow[] = []
        public static constructorOptions: Array<Record<string, unknown>> = []

        private readonly listeners = new Map<string, Listener[]>()

        public static getAllWindows(): BrowserWindow[] {
          return BrowserWindow.windows
        }

        public webContents = {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn(),
        }

        public show = vi.fn()
        public showInactive = vi.fn()
        public setPosition = vi.fn()

        public constructor(options: Record<string, unknown>) {
          BrowserWindow.windows.push(this)
          BrowserWindow.constructorOptions.push(options)
        }

        public on(event: string, listener: Listener): void {
          const existing = this.listeners.get(event) ?? []
          existing.push(listener)
          this.listeners.set(event, existing)
        }

        public emit(event: string, ...args: unknown[]): void {
          const handlers = this.listeners.get(event) ?? []
          handlers.forEach(handler => handler(...args))
        }

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

      const mainWindow = BrowserWindow.windows[0]
      expect(mainWindow).toBeDefined()
      mainWindow.emit('ready-to-show')

      expect(mainWindow.show).not.toHaveBeenCalled()
      expect(mainWindow.showInactive).not.toHaveBeenCalled()

      const firstWindowOptions = BrowserWindow.constructorOptions[0]
      expect(firstWindowOptions['paintWhenInitiallyHidden']).toBe(true)

      const webPreferences = firstWindowOptions['webPreferences'] as {
        backgroundThrottling?: boolean
      }
      expect(webPreferences.backgroundThrottling).toBe(false)

      app.emit('before-quit')
      expect(dispose).not.toHaveBeenCalled()

      app.emit('will-quit')
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      if (previousNoFocus === undefined) {
        delete process.env['COVE_E2E_NO_FOCUS']
      } else {
        process.env['COVE_E2E_NO_FOCUS'] = previousNoFocus
      }

      if (previousWindowMode === undefined) {
        delete process.env['COVE_E2E_WINDOW_MODE']
      } else {
        process.env['COVE_E2E_WINDOW_MODE'] = previousWindowMode
      }

      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV']
      } else {
        process.env['NODE_ENV'] = previousNodeEnv
      }
    }
  })

  it('shows E2E window in offscreen inactive mode', async () => {
    vi.resetModules()

    const previousNoFocus = process.env['COVE_E2E_NO_FOCUS']
    const previousWindowMode = process.env['COVE_E2E_WINDOW_MODE']
    const previousNodeEnv = process.env['NODE_ENV']
    delete process.env['COVE_E2E_NO_FOCUS']
    process.env['COVE_E2E_WINDOW_MODE'] = 'offscreen'
    process.env['NODE_ENV'] = 'test'

    try {
      const app = createMockApp()
      const dispose = vi.fn()

      class BrowserWindow {
        public static windows: BrowserWindow[] = []
        public static constructorOptions: Array<Record<string, unknown>> = []

        private readonly listeners = new Map<string, Listener[]>()

        public static getAllWindows(): BrowserWindow[] {
          return BrowserWindow.windows
        }

        public webContents = {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn(),
        }

        public show = vi.fn()
        public showInactive = vi.fn()
        public setPosition = vi.fn()

        public constructor(options: Record<string, unknown>) {
          BrowserWindow.windows.push(this)
          BrowserWindow.constructorOptions.push(options)
        }

        public on(event: string, listener: Listener): void {
          const existing = this.listeners.get(event) ?? []
          existing.push(listener)
          this.listeners.set(event, existing)
        }

        public emit(event: string, ...args: unknown[]): void {
          const handlers = this.listeners.get(event) ?? []
          handlers.forEach(handler => handler(...args))
        }

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

      const mainWindow = BrowserWindow.windows[0]
      expect(mainWindow).toBeDefined()
      mainWindow.emit('ready-to-show')

      expect(mainWindow.showInactive).toHaveBeenCalledTimes(1)
      expect(mainWindow.show).not.toHaveBeenCalled()
      expect(mainWindow.setPosition).toHaveBeenCalledWith(-50000, -50000, false)

      const firstWindowOptions = BrowserWindow.constructorOptions[0]
      expect(firstWindowOptions['x']).toBe(-50000)
      expect(firstWindowOptions['y']).toBe(-50000)
      expect(firstWindowOptions['paintWhenInitiallyHidden']).toBeUndefined()

      const webPreferences = firstWindowOptions['webPreferences'] as {
        backgroundThrottling?: boolean
      }
      expect(webPreferences.backgroundThrottling).toBe(false)

      app.emit('before-quit')
      expect(dispose).not.toHaveBeenCalled()

      app.emit('will-quit')
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      if (previousNoFocus === undefined) {
        delete process.env['COVE_E2E_NO_FOCUS']
      } else {
        process.env['COVE_E2E_NO_FOCUS'] = previousNoFocus
      }

      if (previousWindowMode === undefined) {
        delete process.env['COVE_E2E_WINDOW_MODE']
      } else {
        process.env['COVE_E2E_WINDOW_MODE'] = previousWindowMode
      }

      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV']
      } else {
        process.env['NODE_ENV'] = previousNodeEnv
      }
    }
  })
})
