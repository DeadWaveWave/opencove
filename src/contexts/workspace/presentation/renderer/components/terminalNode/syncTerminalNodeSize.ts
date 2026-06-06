import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import { resolveStablePtySize } from '../../utils/terminalResize'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import {
  calibrateMeasuredGeometryForRenderer,
  releaseXtermRootHeightForMeasurement,
} from './domRendererGeometry'
import { applyTerminalNodeGeometryLocally } from './applyTerminalNodeGeometryLocally'
import { refreshTerminalNodeSize } from './refreshTerminalNodeSize'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'
import { canRefreshTerminalLayout } from './terminalGeometryLayout'
import { resolveStableMeasuredTerminalNodeGeometry } from './stableMeasuredTerminalNodeGeometry'
import type {
  FitTerminalNodeOptions,
  InitialTerminalNodeGeometryCommitResult,
  PtySize,
} from './terminalGeometryTypes'

export { refreshTerminalNodeSize } from './refreshTerminalNodeSize'
export { createTerminalDomTextOverhangGeometryCommitScheduler } from './terminalDomTextOverhangGeometryCommitScheduler'
export type { InitialTerminalNodeGeometryCommitResult } from './terminalGeometryTypes'

export function commitTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  options,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  options?: FitTerminalNodeOptions
}): void {
  const nextPtySize = fitTerminalNodeToMeasuredSize({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    options,
  })

  if (!nextPtySize) {
    if (options?.logWhenStable !== false) {
      logTerminalGeometryDiagnostics({
        event: 'geometry-commit-skipped',
        terminal: terminalRef.current,
        fitAddon: fitAddonRef.current,
        container: containerRef.current,
        sessionId,
        reason,
        lastCommittedPtySize: lastCommittedPtySizeRef.current,
        skippedReason: 'no-next-size',
      })
    }
    return
  }

  logTerminalGeometryDiagnostics({
    event: 'geometry-commit-resize',
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
    container: containerRef.current,
    sessionId,
    reason,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    nextPtySize,
  })
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
  options,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef?: MutableRefObject<{ cols: number; rows: number } | null>
  options?: FitTerminalNodeOptions
}): { cols: number; rows: number } | null {
  const terminal = terminalRef.current
  const fitAddon = fitAddonRef.current
  const container = containerRef.current

  if (!terminal || !fitAddon) {
    logTerminalGeometryDiagnostics({
      event: 'geometry-fit-skipped',
      terminal,
      fitAddon,
      container,
      sessionId: null,
      lastCommittedPtySize: lastCommittedPtySizeRef?.current ?? null,
      skippedReason: !terminal ? 'missing-terminal' : 'missing-fit-addon',
    })
    return null
  }

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef }) || !container) {
    logTerminalGeometryDiagnostics({
      event: 'geometry-fit-skipped',
      terminal,
      fitAddon,
      container,
      sessionId: null,
      lastCommittedPtySize: lastCommittedPtySizeRef?.current ?? null,
      skippedReason: !container
        ? 'missing-container'
        : container.clientWidth <= 2 || container.clientHeight <= 2
          ? 'container-too-small'
          : isPointerResizingRef.current
            ? 'pointer-resizing'
            : 'unknown',
    })
    return null
  }

  releaseXtermRootHeightForMeasurement(terminal)
  const proposed = fitAddon.proposeDimensions()
  if (!proposed) {
    logTerminalGeometryDiagnostics({
      event: 'geometry-fit-no-measurement',
      terminal,
      fitAddon,
      container,
      sessionId: null,
      lastCommittedPtySize: lastCommittedPtySizeRef?.current ?? null,
      skippedReason: 'propose-dimensions-null',
    })
    return null
  }

  const measured = calibrateMeasuredGeometryForRenderer({
    container,
    measured: proposed,
  })

  const nextPtySize = resolveStablePtySize({
    previous: lastCommittedPtySizeRef?.current ?? null,
    measured,
    preventRowShrink: false,
  })

  if (!nextPtySize) {
    const committedPtySize = lastCommittedPtySizeRef?.current ?? null
    // If PTY size hasn't changed, check if terminal geometry needs to be synchronized
    if (
      committedPtySize !== null &&
      committedPtySize.cols === measured.cols &&
      committedPtySize.rows === measured.rows
    ) {
      // Only restore if terminal is out of sync
      if (terminal.cols !== measured.cols || terminal.rows !== measured.rows) {
        resizeTerminalPreservingScrollState(terminal, measured.cols, measured.rows)
        refreshTerminalNodeSize({
          terminalRef,
          containerRef,
          isPointerResizingRef,
        })
        logTerminalGeometryDiagnostics({
          event: 'geometry-fit-local-restore',
          terminal,
          fitAddon,
          container,
          sessionId: null,
          lastCommittedPtySize: committedPtySize,
          measured,
        })
      }
      return null
    }

    if (options?.logWhenStable !== false) {
      logTerminalGeometryDiagnostics({
        event: 'geometry-fit-no-stable-size',
        terminal,
        fitAddon,
        container,
        sessionId: null,
        lastCommittedPtySize: lastCommittedPtySizeRef?.current ?? null,
        measured,
        skippedReason: 'resolve-stable-size-null',
      })
    }
    if (options?.refreshWhenStable !== false) {
      refreshTerminalNodeSize({
        terminalRef,
        containerRef,
        isPointerResizingRef,
      })
    }
    return null
  }

  if (terminal.cols !== nextPtySize.cols || terminal.rows !== nextPtySize.rows) {
    resizeTerminalPreservingScrollState(terminal, nextPtySize.cols, nextPtySize.rows)
  }

  if (lastCommittedPtySizeRef) {
    lastCommittedPtySizeRef.current = nextPtySize
  }
  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
    fitAddonRef,
  })
  logTerminalGeometryDiagnostics({
    event: 'geometry-fit-applied',
    terminal,
    fitAddon,
    container,
    sessionId: null,
    lastCommittedPtySize: lastCommittedPtySizeRef?.current ?? null,
    measured,
    nextPtySize,
  })

  return nextPtySize
}

async function commitMeasuredTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  nextPtySize,
  commitEvent,
  skippedEvent,
  unchangedEvent,
  shouldCommit,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  nextPtySize: PtySize | null
  commitEvent: string
  skippedEvent: string
  unchangedEvent: string
  shouldCommit?: () => boolean
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  if (!nextPtySize) {
    logTerminalGeometryDiagnostics({
      event: skippedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      skippedReason: 'no-next-size',
    })
    return null
  }

  if (shouldCommit && !shouldCommit()) {
    logTerminalGeometryDiagnostics({
      event: skippedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      nextPtySize,
      skippedReason: 'stale-session',
    })
    return null
  }

  applyTerminalNodeGeometryLocally({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    size: nextPtySize,
  })

  const alreadyCommitted =
    lastCommittedPtySizeRef.current?.cols === nextPtySize.cols &&
    lastCommittedPtySizeRef.current.rows === nextPtySize.rows

  if (alreadyCommitted) {
    logTerminalGeometryDiagnostics({
      event: unchangedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      nextPtySize,
    })
    return { ...nextPtySize, changed: false }
  }

  await window.opencoveApi.pty.resize({
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
    reason,
  })

  lastCommittedPtySizeRef.current = nextPtySize
  logTerminalGeometryDiagnostics({
    event: commitEvent,
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
    container: containerRef.current,
    sessionId,
    reason,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    nextPtySize,
  })
  return { ...nextPtySize, changed: true }
}

export async function commitSettledTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  shouldCommit,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  shouldCommit?: () => boolean
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  const nextPtySize = await resolveStableMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
  })

  return await commitMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    sessionId,
    reason,
    nextPtySize,
    commitEvent: 'geometry-settled-commit-resized',
    skippedEvent: 'geometry-settled-commit-skipped',
    unchangedEvent: 'geometry-settled-commit-unchanged',
    shouldCommit,
  })
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
  const nextPtySize = await resolveStableMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
  })

  return await commitMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    sessionId,
    reason,
    nextPtySize,
    commitEvent: 'geometry-initial-commit-resized',
    skippedEvent: 'geometry-initial-commit-skipped',
    unchangedEvent: 'geometry-initial-commit-unchanged',
  })
}
