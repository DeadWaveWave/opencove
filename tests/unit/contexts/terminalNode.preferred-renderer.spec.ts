import { beforeEach, describe, expect, it, vi } from 'vitest'

const webglAddonDispose = vi.fn()
const webglAddonClearTextureAtlas = vi.fn()
const webglAddonConstructor = vi.fn()

type Listener = () => void

let contextLossListener: Listener | null = null

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

    public constructor() {
      webglAddonConstructor()
    }

    public activate(): void {}

    public dispose(): void {
      webglAddonDispose()
    }

    public clearTextureAtlas(): void {
      webglAddonClearTextureAtlas()
    }
  }

  return {
    WebglAddon: MockWebglAddon,
  }
})

describe('activatePreferredTerminalRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextLossListener = null
  })

  it('loads the WebGL renderer for terminals when webgl is available', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) => {
      return kind === 'webgl2' ? ({} as WebGL2RenderingContext) : null
    }) as never

    try {
      const { activatePreferredTerminalRenderer } =
        await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
      const loadAddon = vi.fn()
      const terminal = {
        loadAddon,
      }

      const activeRenderer = activatePreferredTerminalRenderer(terminal as never, 'opencode')

      expect(webglAddonConstructor).toHaveBeenCalledTimes(1)
      expect(loadAddon).toHaveBeenCalledTimes(1)
      expect(activeRenderer.kind).toBe('webgl')

      activeRenderer.clearTextureAtlas()
      expect(webglAddonClearTextureAtlas).toHaveBeenCalledTimes(1)

      activeRenderer.dispose()
      expect(webglAddonDispose).toHaveBeenCalledTimes(1)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('keeps the DOM renderer when webgl rendering is unavailable', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never

    try {
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
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('loads the WebGL renderer for Codex terminals when webgl is available', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) => {
      return kind === 'webgl2' ? ({} as WebGL2RenderingContext) : null
    }) as never

    try {
      const { activatePreferredTerminalRenderer } =
        await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
      const loadAddon = vi.fn()

      const activeRenderer = activatePreferredTerminalRenderer({ loadAddon } as never, 'codex')

      expect(loadAddon).toHaveBeenCalledTimes(1)
      expect(activeRenderer.kind).toBe('webgl')
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('falls back by disposing the WebGL addon when context is lost', async () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) => {
      return kind === 'webgl2' ? ({} as WebGL2RenderingContext) : null
    }) as never

    try {
      const { activatePreferredTerminalRenderer } =
        await import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer')
      const activeRenderer = activatePreferredTerminalRenderer(
        {
          loadAddon: vi.fn(),
        } as never,
        'opencode',
      )

      expect(activeRenderer.kind).toBe('webgl')
      expect(contextLossListener).toBeTypeOf('function')

      contextLossListener?.()

      expect(webglAddonDispose).toHaveBeenCalledTimes(1)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})
