import { vi } from 'vitest'

declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver
  }
}

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    public static lastInstance: MockTerminal | null = null

    public cols = 80
    public rows = 24
    public options: Record<string, unknown> = { fontSize: 13 }
    public refreshCalls = 0

    public constructor(options?: Record<string, unknown> & { cols?: number; rows?: number }) {
      MockTerminal.lastInstance = this
      this.cols = options?.cols ?? 80
      this.rows = options?.rows ?? 24
      this.options = { ...this.options, ...(options ?? {}) }
    }

    public loadAddon(addon: { activate?: (terminal: MockTerminal) => void }): void {
      addon.activate?.(this)
    }

    public open(): void {}
    public focus(): void {}
    public refresh(): void {
      this.refreshCalls += 1
    }
    public dispose(): void {}
    public attachCustomKeyEventHandler(): void {}
    public registerLinkProvider(): { dispose: () => void } {
      return { dispose: () => undefined }
    }
    public onData() {
      return { dispose: () => undefined }
    }
    public onBinary() {
      return { dispose: () => undefined }
    }
    public write(_data: string, callback?: () => void): void {
      callback?.()
    }
  }

  return {
    Terminal: MockTerminal,
    __getLastTerminal: () => MockTerminal.lastInstance,
  }
})

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    public fit(): void {}
  }
  return { FitAddon: MockFitAddon }
})

vi.mock('@xterm/addon-serialize', () => {
  class MockSerializeAddon {
    public activate(): void {}
    public serialize(): string {
      return '[mock-serialized]'
    }
    public dispose(): void {}
  }
  return { SerializeAddon: MockSerializeAddon }
})

vi.mock('@xyflow/react', async () => {
  const ReactModule = await import('react')
  return {
    Handle: ({ type }: { type: string }) =>
      ReactModule.createElement('div', { 'data-testid': `react-flow-handle-${type}` }),
    Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: unknown) => unknown) =>
      selector({ coveDragSurfaceSelectionMode: false }),
  }
})

export function installTerminalThemeResizeObserverMock(): void {
  if (typeof window.ResizeObserver !== 'undefined') {
    return
  }
  window.ResizeObserver = class ResizeObserver {
    public observe(): void {}
    public disconnect(): void {}
    public unobserve(): void {}
  }
}

export function installTerminalThemePtyApiMock(): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      meta: { isTest: true, platform: 'darwin', windowsPty: null },
      pty: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        snapshot: vi.fn(async () => ({ data: '' })),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        write: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
      },
    },
  })
}
