import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'

export function useTerminalAppearanceSync({
  terminalRef,
  syncTerminalSize,
  terminalFontSize,
  terminalFontFamily,
  width,
  height,
}: {
  terminalRef: RefObject<Terminal | null>
  syncTerminalSize: () => void
  terminalFontSize: number
  terminalFontFamily: string | null
  width: number
  height: number
}): void {
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.fontSize = terminalFontSize
    syncTerminalSize()
  }, [syncTerminalSize, terminalFontSize, terminalRef])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.fontFamily = terminalFontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
    syncTerminalSize()
  }, [syncTerminalSize, terminalFontFamily, terminalRef])

  useEffect(() => {
    const frame = requestAnimationFrame(syncTerminalSize)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height, syncTerminalSize, width])
}
