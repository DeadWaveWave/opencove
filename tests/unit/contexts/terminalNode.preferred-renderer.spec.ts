import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const webglAddonDispose = vi.fn()
const webglAddonClearTextureAtlas = vi.fn()
const webglAddonConstructor = vi.fn()
const webglAddonSetRasterScale = vi.fn()

type Listener = () => void

let contextLossListener: Listener | null = null

const originalGetContext = HTMLCanvasElement.prototype.getContext
const loseProbeContext = vi.fn()

function installCanvasContexts(available: readonly string[]) {
  const getContext = vi.fn((kind: string) =>
    available.includes(kind)
      ? ({
          getExtension: (name: string) =>
            name === 'WEBGL_lose_context' ? { loseContext: loseProbeContext } : null,
        } as unknown as WebGL2RenderingContext)
      : null,
  )
  HTMLCanvasElement.prototype.getContext = getContext as never
  return getContext
}

vi.mock('@xterm/addon-webgl', () => {
  class MockWebglAddon {
    public onContextLoss(listener: Listener) {
      contextLossListener = listener
      return {
        dispose: vi.fn(() => {
          if (contextLossListener === listener) {
            contextLossListener = null
          }
        }),
      }
    }

    public constructor(preserveDrawingBuffer?: boolean) {
      webglAddonConstructor(preserveDrawingBuffer)
    }

    public activate(): void {}

    public dispose(): void {
      webglAddonDispose()
    }

    public clearTextureAtlas(): void {
      webglAddonClearTextureAtlas()
    }

    public setRasterScale(scale: number): boolean {
      webglAddonSetRasterScale(scale)
      return true
    }
  }

  return {
    WebglAddon: MockWebglAddon,
  }
})

describe('activatePreferredTerminalRenderer', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    contextLossListener = null
    const { resetPreferredTerminalRendererStateForTests } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    resetPreferredTerminalRendererStateForTests()
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1,
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          platform: 'darwin',
        },
      },
    })
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('uses the WebGL renderer for Windows agent sessions when available', async () => {
    installCanvasContexts(['webgl2'])
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: { meta: { platform: 'win32' } },
    })

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, 'codex', {
      terminalKind: 'agent',
    })

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
    activeRenderer.dispose()
  })

  it('uses the WebGL renderer for regular Windows terminals when available', async () => {
    installCanvasContexts(['webgl2'])
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.25,
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          platform: 'win32',
        },
      },
    })

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, null, {
      terminalKind: 'terminal',
    })

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
    activeRenderer.dispose()
  })

  it('keeps OpenCode Windows agents on the WebGL renderer', async () => {
    installCanvasContexts(['webgl2'])
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.25,
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          platform: 'win32',
        },
      },
    })

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, 'opencode', {
      terminalKind: 'agent',
    })

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
    expect(webglAddonConstructor).toHaveBeenCalledWith(undefined)
    activeRenderer.dispose()
  })

  it('lets required OpenCode Windows agents bypass the WebGL renderer budget', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, 'opencode', {
      terminalKind: 'agent',
      webglRendererBudget: 0,
    })

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
    activeRenderer.dispose()
  })

  it('loads the WebGL renderer for terminals when webgl is available', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const terminal = { loadAddon, rows: 24, refresh: vi.fn() }

    const activeRenderer = activatePreferredTerminalRenderer(terminal as never, 'opencode')

    expect(webglAddonConstructor).toHaveBeenCalledTimes(1)
    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')

    activeRenderer.refresh()
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23)
    expect(webglAddonClearTextureAtlas).not.toHaveBeenCalled()
    expect(activeRenderer.setRasterScale(1.25)).toBe(true)
    expect(webglAddonSetRasterScale).toHaveBeenCalledWith(1.25)

    activeRenderer.dispose()
    expect(webglAddonDispose).toHaveBeenCalledTimes(1)
  })

  it('caps active WebGL renderers to avoid browser context churn', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const first = activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex', {
      webglRendererBudget: 1,
    })
    const second = activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex', {
      webglRendererBudget: 1,
    })

    expect(first.kind).toBe('webgl')
    expect(second.kind).toBe('dom')

    first.dispose()

    const third = activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex', {
      webglRendererBudget: 1,
    })
    expect(third.kind).toBe('webgl')
    third.dispose()
  })

  it('keeps the default WebGL renderer budget at eight contexts', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const renderers = Array.from({ length: 9 }, () =>
      activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex'),
    )

    expect(renderers.slice(0, 8).every(renderer => renderer.kind === 'webgl')).toBe(true)
    expect(renderers[8]?.kind).toBe('dom')
    renderers.forEach(renderer => renderer.dispose())
  })

  it('keeps the DOM renderer when webgl rendering is unavailable', async () => {
    installCanvasContexts([])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer(
      {
        loadAddon,
      } as never,
      'opencode',
    )

    expect(loadAddon).not.toHaveBeenCalled()
    expect(activeRenderer.kind).toBe('dom')
    expect(activeRenderer.setRasterScale(1.25)).toBe(false)
  })

  it('keeps the DOM renderer when recovery forces dom mode', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer(
      {
        loadAddon,
      } as never,
      'codex',
      { preferredMode: 'dom' },
    )

    expect(loadAddon).not.toHaveBeenCalled()
    expect(activeRenderer.kind).toBe('dom')
    expect(activeRenderer.setRasterScale(1.25)).toBe(false)
  })

  it('ignores forced DOM recovery mode for OpenCode agents', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer(
      {
        loadAddon,
      } as never,
      'opencode',
      { preferredMode: 'dom', terminalKind: 'agent' },
    )

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
    activeRenderer.dispose()
  })

  it('loads the WebGL renderer for Codex terminals when webgl is available', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const loadAddon = vi.fn()

    const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, 'codex')

    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(activeRenderer.kind).toBe('webgl')
  })

  it('falls back by disposing the WebGL addon when context is lost', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const onRendererKindChange = vi.fn()
    const onRendererIssue = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer(
      {
        loadAddon: vi.fn(),
      } as never,
      'codex',
      { onRendererKindChange, onRendererIssue },
    )

    expect(activeRenderer.kind).toBe('webgl')
    expect(contextLossListener).toBeTypeOf('function')

    contextLossListener?.()

    expect(webglAddonDispose).toHaveBeenCalledTimes(1)
    expect(onRendererKindChange).toHaveBeenCalledWith('dom')
    expect(onRendererIssue).toHaveBeenCalledWith({
      reason: 'context_loss',
      forceDom: true,
    })
    expect(activeRenderer.kind).toBe('dom')
  })

  it('rebuilds OpenCode agents without forcing DOM when WebGL context is lost', async () => {
    installCanvasContexts(['webgl2'])

    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
    const onRendererKindChange = vi.fn()
    const onRendererIssue = vi.fn()
    const activeRenderer = activatePreferredTerminalRenderer(
      {
        loadAddon: vi.fn(),
      } as never,
      'opencode',
      { terminalKind: 'agent', onRendererKindChange, onRendererIssue },
    )

    expect(activeRenderer.kind).toBe('webgl')
    expect(contextLossListener).toBeTypeOf('function')

    contextLossListener?.()

    expect(webglAddonDispose).toHaveBeenCalledTimes(1)
    expect(onRendererKindChange).toHaveBeenCalledWith('dom')
    expect(onRendererIssue).toHaveBeenCalledWith({
      reason: 'context_loss',
      forceDom: false,
    })
    expect(activeRenderer.kind).toBe('dom')
  })

  it('probes WebGL support once and releases the probe context', async () => {
    const getContext = installCanvasContexts(['webgl2'])
    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')

    // Budget-limited terminals used to probe (and leak) a fresh context each, evicting live renderers.
    const renderers = Array.from({ length: 3 }, () =>
      activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex', {
        webglRendererBudget: 1,
      }),
    )

    expect(renderers.map(renderer => renderer.kind)).toEqual(['webgl', 'dom', 'dom'])
    expect(getContext).toHaveBeenCalledTimes(1)
    expect(loseProbeContext).toHaveBeenCalledTimes(1)
    renderers.forEach(renderer => renderer.dispose())
  })

  it('probes again after WebGL was unavailable, since a failed probe allocates nothing', async () => {
    installCanvasContexts([])
    const { activatePreferredTerminalRenderer } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')

    const first = activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex')
    const getContext = installCanvasContexts(['webgl2'])
    const second = activatePreferredTerminalRenderer({ loadAddon: vi.fn() } as never, 'codex')

    expect(first.kind).toBe('dom')
    expect(second.kind).toBe('webgl')
    expect(getContext).toHaveBeenCalledTimes(1)
    second.dispose()
  })
})
