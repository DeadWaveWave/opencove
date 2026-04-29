import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import { resolveStablePtySize } from '../../utils/terminalResize'

type PtySize = { cols: number; rows: number }
export type InitialTerminalNodeGeometryCommitResult = PtySize & { changed: boolean }

type InitialGeometrySample = PtySize & {
  containerWidth: number
  containerHeight: number
}

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

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        resolve()
      })
      return
    }

    window.setTimeout(resolve, 0)
  })
}

function isSameInitialGeometrySample(
  previous: InitialGeometrySample | null,
  next: InitialGeometrySample,
): boolean {
  return (
    previous !== null &&
    previous.cols === next.cols &&
    previous.rows === next.rows &&
    previous.containerWidth === next.containerWidth &&
    previous.containerHeight === next.containerHeight
  )
}

async function resolveStableInitialTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
}): Promise<PtySize | null> {
  const maxAttempts = 8

  const attemptResolve = async (
    attempt: number,
    previousSample: InitialGeometrySample | null,
    lastResolvedSize: PtySize | null,
  ): Promise<PtySize | null> => {
    if (attempt >= maxAttempts) {
      return lastResolvedSize
    }

    await waitForAnimationFrame()

    const container = containerRef.current
    const nextPtySize = fitTerminalNodeToMeasuredSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
    })

    if (!container || !nextPtySize) {
      return attemptResolve(attempt + 1, previousSample, lastResolvedSize)
    }

    const nextSample: InitialGeometrySample = {
      cols: nextPtySize.cols,
      rows: nextPtySize.rows,
      containerWidth: container.clientWidth,
      containerHeight: container.clientHeight,
    }

    if (isSameInitialGeometrySample(previousSample, nextSample)) {
      return nextPtySize
    }

    return attemptResolve(attempt + 1, nextSample, nextPtySize)
  }

  return attemptResolve(0, null, null)
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
  const nextPtySize = fitTerminalNodeToMeasuredSize({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
  })

  if (!nextPtySize) {
    return
  }

  void window.opencoveApi.pty.resize({
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
    reason,
  })
}

export function fitTerminalNodeToMeasuredSize({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef?: MutableRefObject<{ cols: number; rows: number } | null>
}): { cols: number; rows: number } | null {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current

  if (!terminal || !fitAddon) {
    return null
  }

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef })) {
    return null
  }

  const measured = fitAddon.proposeDimensions()
  if (!measured) {
    return null
  }

  const nextPtySize = resolveStablePtySize({
    previous: lastCommittedPtySizeRef?.current ?? null,
    measured,
    preventRowShrink: false,
  })

  if (!nextPtySize) {
    refreshTerminalNodeSize({
      terminalRef,
      containerRef,
      isPointerResizingRef,
    })
    return null
  }

  if (terminal.cols !== nextPtySize.cols || terminal.rows !== nextPtySize.rows) {
    terminal.resize(nextPtySize.cols, nextPtySize.rows)
  }

  if (lastCommittedPtySizeRef) {
    lastCommittedPtySizeRef.current = nextPtySize
  }
  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
  })

  return nextPtySize
}

export async function commitInitialTerminalNodeGeometry({
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
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  const nextPtySize = await resolveStableInitialTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
  })

  if (!nextPtySize) {
    return null
  }

  const alreadyCommitted =
    lastCommittedPtySizeRef.current?.cols === nextPtySize.cols &&
    lastCommittedPtySizeRef.current.rows === nextPtySize.rows

  if (alreadyCommitted) {
    return { ...nextPtySize, changed: false }
  }

  await window.opencoveApi.pty.resize({
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
    reason,
  })

  lastCommittedPtySizeRef.current = nextPtySize
  return { ...nextPtySize, changed: true }
}
