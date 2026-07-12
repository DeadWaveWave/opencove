import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { resolveStablePtySize } from '../../utils/terminalResize'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'
import { canRefreshTerminalLayout, refreshTerminalNodeSize } from './terminalGeometryLayout'
import type { FitTerminalNodeOptions, PtySize } from './terminalGeometryTypes'

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
  lastCommittedPtySizeRef?: MutableRefObject<PtySize | null>
  options?: FitTerminalNodeOptions
}): PtySize | null {
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
  const measured = proposed

  const nextPtySize = resolveStablePtySize({
    previous: lastCommittedPtySizeRef?.current ?? null,
    measured,
    preventRowShrink: false,
  })

  if (!nextPtySize) {
    const committedPtySize = lastCommittedPtySizeRef?.current ?? null
    const shouldRestoreLocalGeometry =
      committedPtySize !== null &&
      committedPtySize.cols === measured.cols &&
      committedPtySize.rows === measured.rows &&
      (terminal.cols !== measured.cols || terminal.rows !== measured.rows)
    if (shouldRestoreLocalGeometry) {
      resizeTerminalPreservingScrollState(terminal, measured.cols, measured.rows)
      refreshTerminalNodeSize({ terminalRef, containerRef, isPointerResizingRef })
      logTerminalGeometryDiagnostics({
        event: 'geometry-fit-local-restore',
        terminal,
        fitAddon,
        container,
        sessionId: null,
        lastCommittedPtySize: committedPtySize,
        measured,
      })
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
      refreshTerminalNodeSize({ terminalRef, containerRef, isPointerResizingRef })
    }
    return null
  }

  if (terminal.cols !== nextPtySize.cols || terminal.rows !== nextPtySize.rows) {
    resizeTerminalPreservingScrollState(terminal, nextPtySize.cols, nextPtySize.rows)
  }

  if (lastCommittedPtySizeRef) {
    lastCommittedPtySizeRef.current = nextPtySize
  }
  refreshTerminalNodeSize({ terminalRef, containerRef, isPointerResizingRef })
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
