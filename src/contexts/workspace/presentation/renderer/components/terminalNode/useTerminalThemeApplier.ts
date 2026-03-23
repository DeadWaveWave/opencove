import { useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { MutableRefObject } from 'react'
import { resolveActiveUiTheme, resolveTerminalTheme } from './theme'

export function useTerminalThemeApplier({
  terminalRef,
  containerRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLDivElement | null>
}): () => void {
  return useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.theme = { ...resolveTerminalTheme() }
    containerRef.current?.setAttribute('data-cove-terminal-theme', resolveActiveUiTheme())
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [containerRef, terminalRef])
}
