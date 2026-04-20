import { WebglAddon } from '@xterm/addon-webgl'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { Terminal } from '@xterm/xterm'

export type ActiveTerminalRenderer = {
  kind: 'webgl' | 'dom'
  clearTextureAtlas: () => void
  dispose: () => void
}

export interface PreferredTerminalRendererOptions {
  onRendererKindChange?: (kind: ActiveTerminalRenderer['kind']) => void
}

function createDomRenderer(): ActiveTerminalRenderer {
  return {
    kind: 'dom',
    clearTextureAtlas: () => undefined,
    dispose: () => undefined,
  }
}

function canUseWebglRenderer(): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const canvas = document.createElement('canvas')
  if (typeof canvas.getContext !== 'function') {
    return false
  }

  return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
}

export function activatePreferredTerminalRenderer(
  terminal: Terminal,
  _terminalProvider?: AgentProvider | null,
  options: PreferredTerminalRendererOptions = {},
): ActiveTerminalRenderer {
  if (!canUseWebglRenderer()) {
    return createDomRenderer()
  }

  try {
    const webglAddon = new WebglAddon({ customGlyphs: true })
    terminal.loadAddon(webglAddon)

    let disposed = false
    let kind: ActiveTerminalRenderer['kind'] = 'webgl'
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      if (disposed) {
        return
      }

      disposed = true
      kind = 'dom'
      options.onRendererKindChange?.('dom')
      contextLossDisposable.dispose()
      webglAddon.dispose()
    })

    return {
      get kind() {
        return kind
      },
      clearTextureAtlas: () => {
        if (!disposed) {
          webglAddon.clearTextureAtlas()
        }
      },
      dispose: () => {
        if (disposed) {
          return
        }

        disposed = true
        contextLossDisposable.dispose()
        webglAddon.dispose()
      },
    }
  } catch {
    return createDomRenderer()
  }
}
