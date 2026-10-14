import { WebglAddon } from '@xterm/addon-webgl'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRasterScale } from './terminalZoomRasterPolicy'

export type ActiveTerminalRenderer = {
  kind: 'webgl' | 'dom'
  refresh: () => void
  dispose: () => void
  setRasterScale: (scale: TerminalRasterScale) => boolean | undefined
}

export type PreferredTerminalRendererMode = 'auto' | 'dom'

export interface PreferredTerminalRendererOptions {
  preferredMode?: PreferredTerminalRendererMode
  webglRendererBudget?: number
  terminalKind?: 'agent' | 'terminal'
  onRendererKindChange?: (kind: ActiveTerminalRenderer['kind']) => void
  onRendererIssue?: (issue: { reason: 'context_loss'; forceDom: boolean }) => void
}

const DEFAULT_WEBGL_RENDERER_BUDGET = 8

let activeWebglRendererCount = 0

function createDomRenderer(terminal: Terminal): ActiveTerminalRenderer {
  return {
    kind: 'dom',
    refresh: () => terminal.refresh(0, Math.max(0, terminal.rows - 1)),
    dispose: () => undefined,
    setRasterScale: () => false,
  }
}

// Chromium keeps a small number of WebGL contexts alive and evicts the oldest one when a new
// context exceeds that limit. A probe context left for GC therefore costs a live terminal its
// renderer, so the renderer process probes once and releases the probe immediately.
let webglSupported = false

function canUseWebglRenderer(): boolean {
  if (webglSupported) {
    return true
  }

  if (typeof document === 'undefined') {
    return false
  }

  const canvas = document.createElement('canvas')
  if (typeof canvas.getContext !== 'function') {
    return false
  }

  const probe = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!probe) {
    // A failed probe allocates nothing, so later terminals may probe again once the GPU recovers.
    return false
  }

  probe.getExtension('WEBGL_lose_context')?.loseContext()
  webglSupported = true
  return true
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

function requiresWebglRenderer(
  terminalProvider: AgentProvider | null | undefined,
  options: PreferredTerminalRendererOptions,
): boolean {
  return terminalProvider === 'opencode' && options.terminalKind === 'agent'
}

export function resetPreferredTerminalRendererStateForTests(): void {
  activeWebglRendererCount = 0
  webglSupported = false
}

export function activatePreferredTerminalRenderer(
  terminal: Terminal,
  terminalProvider?: AgentProvider | null,
  options: PreferredTerminalRendererOptions = {},
): ActiveTerminalRenderer {
  const mustUseWebgl = requiresWebglRenderer(terminalProvider, options)

  if (options.preferredMode === 'dom' && !mustUseWebgl) {
    return createDomRenderer(terminal)
  }

  if (!canUseWebglRenderer()) {
    return createDomRenderer(terminal)
  }

  if (!mustUseWebgl && !hasWebglRendererBudget(options.webglRendererBudget)) {
    return createDomRenderer(terminal)
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
      refresh: () => {
        if (!disposed) {
          // xterm shares its atlas across terminals. Clearing it leaves sibling glyph models
          // pointing at reused texture coordinates; layout refresh must never mutate that cache.
          terminal.refresh(0, Math.max(0, terminal.rows - 1))
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
      setRasterScale: scale => {
        if (disposed) {
          return false
        }

        return webglAddon.setRasterScale(scale)
      },
    }
  } catch {
    return createDomRenderer(terminal)
  }
}
