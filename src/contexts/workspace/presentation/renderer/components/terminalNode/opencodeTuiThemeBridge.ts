import type { Terminal } from '@xterm/xterm'
import { registerOpenCodeOscColorQueryResponder } from './opencodeOscColorQueryResponder'
import { resolveTerminalUiTheme, type TerminalThemeMode } from './theme'

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
  flush: () => void
}

const OPENCODE_ALT_SCREEN_ENABLE_SEQUENCE = '\u001b[?1049h'
const OPENCODE_ALT_SCREEN_DISABLE_SEQUENCE = '\u001b[?1049l'
const OPENCODE_ALT_SCREEN_MATCH_BUFFER_SIZE = 32

function buildOpenCodeThemeModeReport(themeMode: 'light' | 'dark'): string {
  return themeMode === 'light' ? '\u001b[?997;2n' : '\u001b[?997;1n'
}

function isTerminalInAltScreen(terminal: Terminal): boolean {
  try {
    return terminal.buffer.active.type === 'alternate'
  } catch {
    return false
  }
}

export function createOpenCodeTuiThemeBridge({
  terminal,
  ptyWriteQueue,
  terminalThemeMode,
}: {
  terminal: Terminal
  ptyWriteQueue: PtyWriteQueue
  terminalThemeMode: TerminalThemeMode
}): {
  handlePtyOutputChunk: (data: string) => void
  reportThemeMode: () => void
  dispose: () => void
} {
  const disposeOscResponder = registerOpenCodeOscColorQueryResponder({ terminal, ptyWriteQueue })
  let isAltScreenActive = false
  let lastReported: 'light' | 'dark' | null = null
  let matchBuffer = ''

  const reportThemeMode = (): void => {
    const resolvedTheme = resolveTerminalUiTheme(terminalThemeMode)

    const altScreenActive = isAltScreenActive || isTerminalInAltScreen(terminal)
    if (!altScreenActive || lastReported === resolvedTheme) {
      return
    }

    isAltScreenActive = altScreenActive
    const report = buildOpenCodeThemeModeReport(resolvedTheme)
    ptyWriteQueue.enqueue(report)
    ptyWriteQueue.flush()
    lastReported = resolvedTheme
  }

  const handlePtyOutputChunk = (data: string): void => {
    if (typeof data !== 'string' || data.length === 0) {
      return
    }

    const combined = `${matchBuffer}${data}`
    matchBuffer = combined.slice(-OPENCODE_ALT_SCREEN_MATCH_BUFFER_SIZE)

    const lastEnable = combined.lastIndexOf(OPENCODE_ALT_SCREEN_ENABLE_SEQUENCE)
    const lastDisable = combined.lastIndexOf(OPENCODE_ALT_SCREEN_DISABLE_SEQUENCE)
    if (lastEnable === -1 && lastDisable === -1) {
      return
    }

    const previousState = isAltScreenActive
    isAltScreenActive = lastEnable > lastDisable

    if (!previousState && isAltScreenActive) {
      reportThemeMode()
    } else if (previousState && !isAltScreenActive) {
      lastReported = null
    }
  }

  return {
    handlePtyOutputChunk,
    reportThemeMode,
    dispose: () => {
      disposeOscResponder()
    },
  }
}
