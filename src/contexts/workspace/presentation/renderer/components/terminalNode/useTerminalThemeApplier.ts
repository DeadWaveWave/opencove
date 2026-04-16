import { useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { MutableRefObject } from 'react'
import { resolveTerminalTheme, resolveTerminalUiTheme, type TerminalThemeMode } from './theme'

export function useTerminalThemeApplier({
  terminalRef,
  containerRef,
  terminalThemeMode = 'sync-with-ui',
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLDivElement | null>
  terminalThemeMode?: TerminalThemeMode
}): () => void {
  return useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)
    const container = containerRef.current
    const terminalNode = container?.closest('.terminal-node') ?? null
    container?.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
    terminalNode?.setAttribute('data-cove-terminal-node-theme', resolvedTerminalUiTheme)
    terminal.options.theme = { ...resolveTerminalTheme(terminalThemeMode, terminalNode) }
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [containerRef, terminalRef, terminalThemeMode])
}
