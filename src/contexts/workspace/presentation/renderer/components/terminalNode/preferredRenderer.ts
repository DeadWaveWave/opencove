import { WebglAddon } from '@xterm/addon-webgl'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { Terminal } from '@xterm/xterm'

export type ActiveTerminalRenderer = {
  kind: 'webgl' | 'dom'
  clearTextureAtlas: () => void
  dispose: () => void
}

export type PreferredTerminalRendererMode = 'auto' | 'dom'

export interface PreferredTerminalRendererOptions {
  preferredMode?: PreferredTerminalRendererMode
  webglRendererBudget?: number
  runtimePlatform?: string
  terminalKind?: 'agent' | 'terminal'
  onRendererKindChange?: (kind: ActiveTerminalRenderer['kind']) => void
  onRendererIssue?: (issue: { reason: 'context_loss'; forceDom: boolean }) => void
}

const DEFAULT_WEBGL_RENDERER_BUDGET = 8

let activeWebglRendererCount = 0

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

function resolveWebglRendererBudget(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_WEBGL_RENDERER_BUDGET
  }

  if (!Number.isFinite(value)) {
    return DEFAULT_WEBGL_RENDERER_BUDGET
  }

  return Math.max(0, Math.floor(value))
}

function hasWebglRendererBudget(value: number | undefined): boolean {
  return activeWebglRendererCount < resolveWebglRendererBudget(value)
}

function resolveRuntimePlatform(explicitPlatform: string | undefined): string | null {
  if (typeof explicitPlatform === 'string' && explicitPlatform.length > 0) {
    return explicitPlatform
  }

  return typeof window !== 'undefined' ? (window.opencoveApi?.meta?.platform ?? null) : null
}

function requiresWebglRenderer(
  terminalProvider: AgentProvider | null | undefined,
  options: PreferredTerminalRendererOptions,
): boolean {
  return terminalProvider === 'opencode' && options.terminalKind === 'agent'
}

function shouldForceDomRenderer(
  terminalProvider: AgentProvider | null | undefined,
  options: PreferredTerminalRendererOptions,
): boolean {
  return (
    resolveRuntimePlatform(options.runtimePlatform) === 'win32' &&
    !requiresWebglRenderer(terminalProvider, options)
  )
}

export function resetPreferredTerminalRendererStateForTests(): void {
  activeWebglRendererCount = 0
}

export function activatePreferredTerminalRenderer(
  terminal: Terminal,
  terminalProvider?: AgentProvider | null,
  options: PreferredTerminalRendererOptions = {},
): ActiveTerminalRenderer {
  const mustUseWebgl = requiresWebglRenderer(terminalProvider, options)

  if (options.preferredMode === 'dom' && !mustUseWebgl) {
    return createDomRenderer()
  }

  if (shouldForceDomRenderer(terminalProvider, options)) {
    return createDomRenderer()
  }

  if (!canUseWebglRenderer()) {
    return createDomRenderer()
  }

  if (!mustUseWebgl && !hasWebglRendererBudget(options.webglRendererBudget)) {
    return createDomRenderer()
  }

  try {
    const webglAddon = new WebglAddon()
    terminal.loadAddon(webglAddon)

    let disposed = false
    let kind: ActiveTerminalRenderer['kind'] = 'webgl'
    activeWebglRendererCount += 1
    const releaseWebglBudget = () => {
      activeWebglRendererCount = Math.max(0, activeWebglRendererCount - 1)
    }
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      if (disposed) {
        return
      }

      disposed = true
      kind = 'dom'
      releaseWebglBudget()
      options.onRendererKindChange?.('dom')
      options.onRendererIssue?.({
        reason: 'context_loss',
        forceDom: !mustUseWebgl,
      })
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
        releaseWebglBudget()
      },
    }
  } catch {
    return createDomRenderer()
  }
}
