import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { runTerminalRenderMutationSafely } from './renderServiceSafety'
import {
  calibrateMeasuredGeometryForRenderer,
  clampXtermHeightToExactRows,
  releaseXtermRootHeightForMeasurement,
  syncDomRendererDimensionsToCurrentGeometry,
} from './domRendererGeometry'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'
import { canRefreshTerminalLayout } from './terminalGeometryLayout'

export function refreshTerminalNodeSize({
  terminalRef,
  containerRef,
  isPointerResizingRef,
  fitAddonRef,
  force = false,
  clearRendererCache,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  fitAddonRef?: MutableRefObject<FitAddon | null>
  force?: boolean
  clearRendererCache?: () => void
}): void {
  const terminal = terminalRef.current
  const container = containerRef.current
  const fitAddon = fitAddonRef?.current

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef })) {
    logTerminalGeometryDiagnostics({
      event: 'geometry-refresh-skipped',
      terminal,
      fitAddon: null,
      container,
      sessionId: null,
      skippedReason: !terminal
        ? 'missing-terminal'
        : !container
          ? 'missing-container'
          : container.clientWidth <= 2 || container.clientHeight <= 2
            ? 'container-too-small'
            : isPointerResizingRef.current
              ? 'pointer-resizing'
              : 'unknown',
    })
    return
  }

  if (!terminal) {
    return
  }

  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return
  }

  // Release height constraint before syncing dimensions
  releaseXtermRootHeightForMeasurement(terminal)

  // When forced (e.g., after zoom), recalculate geometry with FitAddon.
  if (force && fitAddon) {
    const proposed = fitAddon.proposeDimensions()
    if (proposed) {
      const calibrated = calibrateMeasuredGeometryForRenderer({
        container,
        measured: proposed,
      })
      const cols = calibrated.cols
      const rows = proposed.rows

      if (cols !== terminal.cols || rows !== terminal.rows) {
        resizeTerminalPreservingScrollState(terminal, cols, rows)
      }
    }
  }

  // Sync DOM renderer dimensions to current geometry
  // Always force sync here because we may have just resized the terminal
  syncDomRendererDimensionsToCurrentGeometry({ terminal, container, force: true })

  // Clamp height to exact rows after sync
  clampXtermHeightToExactRows(terminal)

  // Clear WebGL texture atlas before refresh (for WebGL renderer)
  clearRendererCache?.()

  // Force full refresh of the terminal display
  runTerminalRenderMutationSafely(() => {
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  })

  logTerminalGeometryDiagnostics({
    event: force ? 'geometry-refresh-forced' : 'geometry-refresh',
    terminal,
    fitAddon: fitAddon ?? null,
    container,
    sessionId: null,
  })
}
