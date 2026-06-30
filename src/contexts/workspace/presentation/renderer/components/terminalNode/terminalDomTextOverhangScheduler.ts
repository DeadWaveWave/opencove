import type { MutableRefObject } from 'react'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { resolveDomRendererSafeMeasuredSize } from './terminalGeometryDomSafety'
import {
  logDomTextOverhangSchedulerDiagnostics,
  logTerminalGeometryDiagnostics,
} from './terminalGeometryDiagnostics'
import { canRefreshTerminalLayout, refreshTerminalNodeSize } from './terminalGeometryLayout'
import type { PtySize, TerminalGeometryRefs } from './terminalGeometryTypes'

function reconcileDomRendererTextOverhangLocally({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  sessionId,
  lastCommittedPtySizeRef,
  lastOutputCorrection,
  suppressPtyResize,
  remainingFrames,
}: TerminalGeometryRefs & {
  sessionId: string
  lastOutputCorrection: PtySize | null
  suppressPtyResize: boolean
  remainingFrames: number
}): PtySize | null {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current
  if (
    !canRefreshTerminalLayout({ terminal, container, isPointerResizingRef }) ||
    !terminal ||
    !fitAddon ||
    !container
  ) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      skippedReason: !terminal
        ? 'missing-terminal'
        : !fitAddon
          ? 'missing-fit-addon'
          : !container
            ? 'missing-container'
            : container.clientWidth <= 2 || container.clientHeight <= 2
              ? 'container-too-small'
              : isPointerResizingRef.current
                ? 'pointer-resizing'
                : 'unknown',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  if (suppressPtyResize) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      skippedReason: 'pty-resize-suppressed',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  const committedPtySize = lastCommittedPtySizeRef.current
  if (!committedPtySize) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: null,
      skippedReason: 'missing-committed-pty-size',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  const proposed = fitAddon.proposeDimensions()
  if (!proposed) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: committedPtySize,
      skippedReason: 'propose-dimensions-null',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  const measured = {
    cols: proposed.cols,
    rows: committedPtySize.rows,
  }
  const safeMeasured = resolveDomRendererSafeMeasuredSize({
    terminal,
    container,
    measured,
    referenceCols: committedPtySize.cols,
  })
  const safeMeasuredCols = Math.floor(safeMeasured.cols)
  const isCurrentOutputCorrection =
    lastOutputCorrection !== null &&
    terminal.cols === lastOutputCorrection.cols &&
    terminal.rows === lastOutputCorrection.rows
  const hasRecoverableLocalGeometryDrift =
    terminal.cols <= committedPtySize.cols &&
    (isCurrentOutputCorrection ||
      terminal.cols !== committedPtySize.cols ||
      terminal.rows !== committedPtySize.rows)
  const canRecoverToCommittedGeometry =
    hasRecoverableLocalGeometryDrift && safeMeasuredCols >= committedPtySize.cols
  const canApplySafeShrink =
    safeMeasuredCols < measured.cols && safeMeasuredCols < committedPtySize.cols
  const nextCols = canRecoverToCommittedGeometry
    ? committedPtySize.cols
    : canApplySafeShrink
      ? safeMeasuredCols
      : null

  if (!Number.isFinite(safeMeasuredCols) || safeMeasuredCols <= 0 || nextCols === null) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: committedPtySize,
      skippedReason: 'no-output-safe-column-change',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  const nextPtySize = {
    cols: nextCols,
    rows: committedPtySize.rows,
  }
  if (terminal.cols === nextPtySize.cols && terminal.rows === nextPtySize.rows) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: committedPtySize,
      skippedReason: 'output-correction-already-applied',
      remainingFrames,
      suppressPtyResize,
    })
    return null
  }

  resizeTerminalPreservingScrollState(terminal, nextPtySize.cols, nextPtySize.rows)
  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
  })
  logDomTextOverhangSchedulerDiagnostics({
    event: 'geometry-dom-overhang-local-correction',
    terminal,
    fitAddon,
    container,
    sessionId,
    lastCommittedPtySize: committedPtySize,
    remainingFrames,
    suppressPtyResize,
  })
  return nextPtySize
}

export function createTerminalDomTextOverhangGeometryCommitScheduler({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  suppressPtyResizeRef,
  sessionId,
}: TerminalGeometryRefs & {
  suppressPtyResizeRef: MutableRefObject<boolean>
  sessionId: string
}): { schedule: () => void; dispose: () => void } {
  let frameId: number | null = null
  let disposed = false
  let remainingFrames = 0
  let lastOutputCorrection: PtySize | null = null

  const run = (): void => {
    frameId = null
    if (disposed || sessionId.trim().length === 0) {
      logDomTextOverhangSchedulerDiagnostics({
        event: 'geometry-dom-overhang-scheduler-skipped',
        terminal: terminalRef.current,
        fitAddon: fitAddonRef.current,
        container: containerRef.current,
        sessionId,
        lastCommittedPtySize: lastCommittedPtySizeRef.current,
        skippedReason: disposed ? 'disposed' : 'empty-session-id',
        remainingFrames,
        suppressPtyResize: suppressPtyResizeRef.current,
      })
      return
    }

    const container = containerRef.current
    if (container?.dataset?.coveTerminalRenderer !== 'dom') {
      logDomTextOverhangSchedulerDiagnostics({
        event: 'geometry-dom-overhang-scheduler-skipped',
        terminal: terminalRef.current,
        fitAddon: fitAddonRef.current,
        container,
        sessionId,
        lastCommittedPtySize: lastCommittedPtySizeRef.current,
        skippedReason: 'non-dom-renderer',
        remainingFrames,
        suppressPtyResize: suppressPtyResizeRef.current,
      })
      return
    }

    if (remainingFrames > 0) {
      remainingFrames -= 1
      frameId = window.requestAnimationFrame(run)
      return
    }

    const appliedCorrection = reconcileDomRendererTextOverhangLocally({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      sessionId,
      lastCommittedPtySizeRef,
      lastOutputCorrection,
      suppressPtyResize: suppressPtyResizeRef.current,
      remainingFrames,
    })
    if (appliedCorrection) {
      const committedPtySize = lastCommittedPtySizeRef.current
      lastOutputCorrection =
        committedPtySize !== null &&
        appliedCorrection.cols === committedPtySize.cols &&
        appliedCorrection.rows === committedPtySize.rows
          ? null
          : appliedCorrection
    }
  }

  return {
    schedule: () => {
      if (disposed) {
        return
      }

      remainingFrames = 2
      if (frameId === null) {
        frameId = window.requestAnimationFrame(run)
      }
    },
    dispose: () => {
      disposed = true
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }
      logTerminalGeometryDiagnostics({
        event: 'geometry-dom-overhang-scheduler-disposed',
        terminal: terminalRef.current,
        fitAddon: fitAddonRef.current,
        container: containerRef.current,
        sessionId,
      })
    },
  }
}
