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

const { measureTerminalDisplayReferenceBaseline } =
  await import('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement')
const { registerTerminalDisplayMeasurementHandle } =
  await import('../../../src/shared/runtime/terminalDisplayMeasurementRegistry')

describe('terminal display reference baseline', () => {
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

  it('measures once per font/renderer environment instead of on every request', async () => {
    const input = { terminalFontSize: 14.25, terminalFontFamily: 'Cove Mono' }
    const [first, second] = await Promise.all([
      measureTerminalDisplayReferenceBaseline(input),
      measureTerminalDisplayReferenceBaseline(input),
    ])
    const third = await measureTerminalDisplayReferenceBaseline(input)

    expect(first).toMatchObject({ fontSize: 14.25, cols: 80, rows: 24, cssCellWidth: 8 })
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(terminalsCreated).toHaveBeenCalledTimes(1)
  })

  it('measures again when the font or the device pixel ratio changes', async () => {
    await measureTerminalDisplayReferenceBaseline({
      terminalFontSize: 15.5,
      terminalFontFamily: null,
    })
    await measureTerminalDisplayReferenceBaseline({
      terminalFontSize: 16.5,
      terminalFontFamily: null,
    })
    expect(terminalsCreated).toHaveBeenCalledTimes(2)

    vi.stubGlobal('devicePixelRatio', 2)
    await measureTerminalDisplayReferenceBaseline({
      terminalFontSize: 16.5,
      terminalFontFamily: null,
    })
    expect(terminalsCreated).toHaveBeenCalledTimes(3)
  })
})
