import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import { resolveStablePtySize } from '../../utils/terminalResize'

/**
 * After xterm resizes, the element can end up slightly taller than `rows × cellHeight`
 * because the row count is floored while the container height is not. Clamping the
 * element height removes the dead zone that can otherwise show a duplicate cursor.
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

function canRefreshTerminalLayout(input: {
  terminal: Terminal | null
  container: HTMLElement | null
  isPointerResizingRef: MutableRefObject<boolean>
}): boolean {
  if (!input.terminal || !input.container) {
    return false
  }

  if (input.container.clientWidth <= 2 || input.container.clientHeight <= 2) {
    return false
  }

  if (input.isPointerResizingRef.current) {
    return false
  }

  return true
}

export function refreshTerminalNodeSize({
  terminalRef,
  containerRef,
  isPointerResizingRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
}): void {
  const terminal = terminalRef.current
  const container = containerRef.current

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef })) {
    return
  }

  if (!terminal) {
    return
  }

  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return
  }

  clampXtermHeightToExactRows(terminal)
  terminal.refresh(0, Math.max(0, terminal.rows - 1))
}

export function commitTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
}): void {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current

  if (!terminal || !fitAddon) {
    return
  }

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef })) {
    return
  }

  if (!terminal) {
    return
  }

  const measured = fitAddon.proposeDimensions()
  if (!measured) {
    return
  }

  const nextPtySize = resolveStablePtySize({
    previous: lastCommittedPtySizeRef.current,
    measured,
    preventRowShrink: false,
  })

  if (!nextPtySize) {
    refreshTerminalNodeSize({
      terminalRef,
      containerRef,
      isPointerResizingRef,
    })
    return
  }

  if (terminal.cols !== nextPtySize.cols || terminal.rows !== nextPtySize.rows) {
    terminal.resize(nextPtySize.cols, nextPtySize.rows)
  }

  lastCommittedPtySizeRef.current = nextPtySize
  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
  })

  void window.opencoveApi.pty.resize({
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
    reason,
  })
}
