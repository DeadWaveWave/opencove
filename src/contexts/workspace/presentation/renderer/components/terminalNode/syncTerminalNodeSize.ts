import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { resolveStablePtySize } from '../../utils/terminalResize'

/**
 * After FitAddon.fit(), the xterm element may be taller than `rows × cellHeight`
 * due to Math.floor rounding in the row calculation. The leftover fractional-row
 * pixels at the bottom can cause a duplicate cursor artifact — the real terminal
 * cursor renders in the dead zone while TUI apps (e.g. Claude Code / ink) render
 * their own visual cursor at the prompt. Clamping the element height eliminates
 * the dead zone.
 */
function clampXtermHeightToExactRows(terminal: Terminal): void {
  const xtermEl = terminal.element
  if (!xtermEl) {
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellHeight: unknown = (terminal as any)._core?._renderService?.dimensions?.css?.cell?.height
  if (typeof cellHeight !== 'number' || !Number.isFinite(cellHeight) || cellHeight <= 0) {
    return
  }

  const exactHeight = Math.floor(terminal.rows * cellHeight)
  xtermEl.style.height = `${exactHeight}px`
}

export function syncTerminalNodeSize({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastSyncedPtySizeRef,
  sessionId,
  shouldResizePty = true,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastSyncedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  sessionId: string
  shouldResizePty?: boolean
}): void {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current

  if (!terminal || !fitAddon || !container) {
    return
  }

  if (container.clientWidth <= 2 || container.clientHeight <= 2) {
    return
  }

  if (isPointerResizingRef.current) {
    return
  }

  fitAddon.fit()

  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return
  }

  clampXtermHeightToExactRows(terminal)

  terminal.refresh(0, Math.max(0, terminal.rows - 1))

  const nextPtySize = resolveStablePtySize({
    previous: lastSyncedPtySizeRef.current,
    measured: { cols: terminal.cols, rows: terminal.rows },
    preventRowShrink: false,
  })

  if (!nextPtySize) {
    return
  }

  if (!shouldResizePty) {
    return
  }

  lastSyncedPtySizeRef.current = nextPtySize

  void window.opencoveApi.pty.resize({
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
  })
}
