import type { Terminal } from '@xterm/xterm'
import { registerOpenCodeOscColorQueryResponder } from './opencodeOscColorQueryResponder'
import { resolveTerminalUiTheme, type TerminalThemeMode } from './theme'
import type { TerminalAppearanceSnapshot } from './terminalAppearance'

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
  getAppliedAppearance,
  subscribeAppliedAppearance,
}: {
  terminal: Terminal
  ptyWriteQueue: PtyWriteQueue
  terminalThemeMode: TerminalThemeMode
  getAppliedAppearance?: () => TerminalAppearanceSnapshot | null
  subscribeAppliedAppearance?: (
    listener: (snapshot: TerminalAppearanceSnapshot) => void,
  ) => () => void
}): {
  handlePtyOutputChunk: (data: string) => void
  reportThemeMode: () => void
  dispose: () => void
} {
  const disposeOscResponder = registerOpenCodeOscColorQueryResponder({
    terminal,
    ptyWriteQueue,
    getAppliedAppearance,
  })
  let isAltScreenActive = false
  let lastReportedKey: string | null = null
  let matchBuffer = ''

  const reportThemeMode = (): void => {
    const appliedAppearance = getAppliedAppearance?.() ?? null
    const resolvedTheme =
      appliedAppearance?.terminalScheme ?? resolveTerminalUiTheme(terminalThemeMode)
    const reportKey = appliedAppearance
      ? `revision:${appliedAppearance.revision}`
      : `legacy:${resolvedTheme}`

    const altScreenActive = isAltScreenActive || isTerminalInAltScreen(terminal)
    if (!altScreenActive || lastReportedKey === reportKey) {
      return
    }

    isAltScreenActive = altScreenActive
    const report = buildOpenCodeThemeModeReport(resolvedTheme)
    ptyWriteQueue.enqueue(report)
    ptyWriteQueue.flush()
    lastReportedKey = reportKey
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
      lastReportedKey = null
    }
  }

  const disposeAppliedAppearanceSubscription = subscribeAppliedAppearance?.(() => {
    reportThemeMode()
  })

  return {
    handlePtyOutputChunk,
    reportThemeMode,
    dispose: () => {
      disposeAppliedAppearanceSubscription?.()
      disposeOscResponder()
    },
  }
}
