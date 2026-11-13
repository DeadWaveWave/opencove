import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminalsCreated = vi.fn()

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    _core = {
      _renderService: { dimensions: { css: { cell: { width: 8, height: 16 } } } },
      _coreBrowserService: { dpr: 1 },
    }
    constructor(options: Record<string, unknown>) {
      this.options = { ...options }
      terminalsCreated(options)
    }
    loadAddon(): void {}
    open(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 }
    }
  },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose(): void {}
  },
}))

const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })

const { measureTerminalDisplayReferenceBaseline } =
  await import('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement')
const { registerTerminalDisplayMeasurementHandle } =
  await import('../../../src/shared/runtime/terminalDisplayMeasurementRegistry')

describe('terminal display reference baseline after a font load', () => {
  let unregister: () => void

  beforeEach(() => {
    terminalsCreated.mockClear()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0)
      return 0
    })
    unregister = registerTerminalDisplayMeasurementHandle('node-1', {
      terminal: {} as never,
      fitAddon: {} as never,
      getRendererKind: () => 'dom',
    })
  })

  afterEach(() => {
    unregister()
    vi.unstubAllGlobals()
  })

  it('measures again for a listener that was registered before the first measurement', async () => {
    const input = { terminalFontSize: 18.5, terminalFontFamily: null }

    // The auto-capture hook subscribes on mount, before anything has been measured.
    let refreshed: Promise<unknown> = Promise.resolve()
    const refresh = (): void => {
      refreshed = measureTerminalDisplayReferenceBaseline(input)
    }
    fonts.addEventListener('loadingdone', refresh)

    try {
      await measureTerminalDisplayReferenceBaseline(input)
      expect(terminalsCreated).toHaveBeenCalledTimes(1)

      fonts.dispatchEvent(new Event('loadingdone'))
      await refreshed

      expect(terminalsCreated).toHaveBeenCalledTimes(2)
    } finally {
      fonts.removeEventListener('loadingdone', refresh)
    }
  })
})
