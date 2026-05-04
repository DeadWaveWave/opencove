import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult, TerminalPtyGeometry } from '@shared/contracts/dto'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { commitInitialTerminalNodeGeometry, refreshTerminalNodeSize } from './syncTerminalNodeSize'
import type { CachedTerminalScreenState } from './screenStateCache'
import type { XtermSession } from './xtermSession'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'

type PtySize = { cols: number; rows: number }

function applyCanonicalGeometryLocally({
  terminalRef,
  containerRef,
  isPointerResizingRef,
  geometry,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  geometry: PtySize
}): void {
  const terminal = terminalRef.current
  if (!terminal) {
    return
  }

  if (terminal.cols !== geometry.cols || terminal.rows !== geometry.rows) {
    terminal.resize(geometry.cols, geometry.rows)
  }

  refreshTerminalNodeSize({
    terminalRef,
    containerRef,
    isPointerResizingRef,
  })
}

export function resolveRuntimeInitialTerminalDimensions({
  initialTerminalGeometry,
  cachedScreenState,
  lastCommittedPtySizeRef,
}: {
  initialTerminalGeometry: TerminalPtyGeometry | null
  cachedScreenState: CachedTerminalScreenState | null
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
}): PtySize | null {
  const canonicalInitialDimensions = resolveInitialTerminalDimensions(initialTerminalGeometry)
  if (canonicalInitialDimensions) {
    lastCommittedPtySizeRef.current = canonicalInitialDimensions
    return canonicalInitialDimensions
  }

  return resolveInitialTerminalDimensions(cachedScreenState)
}

export function createRuntimeInitialGeometryCommitter({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  canonicalInitialGeometry,
  allowMeasuredResizeCommit = true,
  preferMeasuredGeometryCommit = false,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  canonicalInitialGeometry?: PtySize | null
  allowMeasuredResizeCommit?: boolean
  preferMeasuredGeometryCommit?: boolean
}) {
  return async (baselineSnapshot: PresentationSnapshotTerminalResult | null) => {
    const canonicalGeometry = baselineSnapshot
      ? { cols: baselineSnapshot.cols, rows: baselineSnapshot.rows }
      : (canonicalInitialGeometry ?? null)

    if (canonicalGeometry && !preferMeasuredGeometryCommit) {
      lastCommittedPtySizeRef.current = canonicalGeometry
      applyCanonicalGeometryLocally({
        terminalRef,
        containerRef,
        isPointerResizingRef,
        geometry: canonicalGeometry,
      })
      return { ...canonicalGeometry, changed: false }
    }

    if (!allowMeasuredResizeCommit) {
      if (!canonicalGeometry) {
        return null
      }

      lastCommittedPtySizeRef.current = canonicalGeometry
      applyCanonicalGeometryLocally({
        terminalRef,
        containerRef,
        isPointerResizingRef,
        geometry: canonicalGeometry,
      })
      return { ...canonicalGeometry, changed: false }
    }

    if (canonicalGeometry) {
      lastCommittedPtySizeRef.current = canonicalGeometry
    }

    const measuredGeometry = await commitInitialTerminalNodeGeometry({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastCommittedPtySizeRef,
      sessionId,
      reason: 'frame_commit',
    })

    if (measuredGeometry) {
      return measuredGeometry
    }

    if (!canonicalGeometry) {
      return null
    }

    lastCommittedPtySizeRef.current = canonicalGeometry
    applyCanonicalGeometryLocally({
      terminalRef,
      containerRef,
      isPointerResizingRef,
      geometry: canonicalGeometry,
    })
    return { ...canonicalGeometry, changed: false }
  }
}

export function resolveRuntimeHydrationBaselineSource({
  preservedSession,
  cachedScreenState,
  rendererBaselineSnapshot,
}: {
  preservedSession: XtermSession | null
  cachedScreenState: CachedTerminalScreenState | null
  rendererBaselineSnapshot: string
}): TerminalHydrationBaselineSource {
  return preservedSession !== null ||
    cachedScreenState?.serialized.length ||
    rendererBaselineSnapshot.trim().length > 0
    ? 'placeholder_snapshot'
    : 'empty'
}
