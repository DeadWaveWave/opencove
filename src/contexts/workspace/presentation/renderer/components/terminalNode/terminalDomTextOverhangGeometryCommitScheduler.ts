import type { MutableRefObject } from 'react'
import { hasDomRendererVisualFootprintRisk } from './domRendererGeometry'
import { refreshTerminalNodeSize } from './refreshTerminalNodeSize'
import { logDomTextOverhangSchedulerDiagnostics } from './terminalGeometryDiagnostics'
import { canRefreshTerminalLayout } from './terminalGeometryLayout'
import type { TerminalGeometryRefs } from './terminalGeometryTypes'

function reconcileDomRendererTextOverhangLocally({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  sessionId,
  lastCommittedPtySizeRef,
  suppressPtyResize,
  remainingFrames,
}: TerminalGeometryRefs & {
  sessionId: string
  suppressPtyResize: boolean
  remainingFrames: number
}): boolean {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current
  if (
    !canRefreshTerminalLayout({ terminal, container, isPointerResizingRef }) ||
    !terminal ||
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
    return false
  }

  if (!hasDomRendererVisualFootprintRisk({ terminal, container })) {
    logDomTextOverhangSchedulerDiagnostics({
      event: 'geometry-dom-overhang-scheduler-skipped',
      terminal,
      fitAddon,
      container,
      sessionId,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      skippedReason: 'no-visual-footprint-risk',
      remainingFrames,
      suppressPtyResize,
    })
    return false
  }

  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
    fitAddonRef,
  })
  logDomTextOverhangSchedulerDiagnostics({
    event: 'geometry-dom-overhang-visual-refresh',
    terminal,
    fitAddon,
    container,
    sessionId,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    remainingFrames,
    suppressPtyResize,
  })
  return true
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

    reconcileDomRendererTextOverhangLocally({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      sessionId,
      lastCommittedPtySizeRef,
      suppressPtyResize: suppressPtyResizeRef.current,
      remainingFrames,
    })
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
    },
  }
}
