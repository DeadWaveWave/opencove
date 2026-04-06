import { WebglAddon } from '@xterm/addon-webgl'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { Terminal } from '@xterm/xterm'

export type ActiveTerminalRenderer = {
  kind: 'webgl' | 'dom'
  clearTextureAtlas: () => void
  dispose: () => void
}

function createDomRenderer(): ActiveTerminalRenderer {
  return {
    kind: 'dom',
    clearTextureAtlas: () => undefined,
    dispose: () => undefined,
  }
}

function resolveDevicePixelRatio(): number {
  if (typeof window === 'undefined') {
    return 1
  }

  const { devicePixelRatio } = window
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
}

function usesFractionalDisplayScaling(): boolean {
  const devicePixelRatio = resolveDevicePixelRatio()
  return Math.abs(devicePixelRatio - Math.round(devicePixelRatio)) > 0.001
}

function shouldPreferDomRendererOnCurrentPlatform(
  terminalProvider?: AgentProvider | null,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (terminalProvider === 'opencode') {
    return false
  }

  const platform = window.opencoveApi?.meta?.platform
  return platform === 'win32' && usesFractionalDisplayScaling()
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
  terminalProvider?: AgentProvider | null,
): ActiveTerminalRenderer {
  if (shouldPreferDomRendererOnCurrentPlatform(terminalProvider) || !canUseWebglRenderer()) {
    return createDomRenderer()
  }

  try {
    const webglAddon = new WebglAddon()
    terminal.loadAddon(webglAddon)

    let disposed = false
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      if (disposed) {
        return
      }

      disposed = true
      contextLossDisposable.dispose()
      webglAddon.dispose()
    })

    return {
      kind: 'webgl',
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
