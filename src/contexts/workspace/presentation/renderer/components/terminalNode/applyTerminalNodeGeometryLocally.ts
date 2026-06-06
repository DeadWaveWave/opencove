import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { refreshTerminalNodeSize } from './refreshTerminalNodeSize'
import type { PtySize } from './terminalGeometryTypes'

export function applyTerminalNodeGeometryLocally({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  size,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  size: PtySize
}): void {
  const terminal = terminalRef.current
  if (!terminal) {
    return
  }

  if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
    resizeTerminalPreservingScrollState(terminal, size.cols, size.rows)
  }

  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
    fitAddonRef,
  })
}
