import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult, TerminalPtyGeometry } from '@shared/contracts/dto'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { commitInitialTerminalNodeGeometry } from './syncTerminalNodeSize'
import type { CachedTerminalScreenState } from './screenStateCache'
import type { XtermSession } from './xtermSession'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'

type PtySize = { cols: number; rows: number }

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
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  canonicalInitialGeometry?: PtySize | null
  allowMeasuredResizeCommit?: boolean
}) {
  return (baselineSnapshot: PresentationSnapshotTerminalResult | null) => {
    if (baselineSnapshot) {
      lastCommittedPtySizeRef.current = {
        cols: baselineSnapshot.cols,
        rows: baselineSnapshot.rows,
      }
    }

    if (!allowMeasuredResizeCommit) {
      const canonicalGeometry = baselineSnapshot
        ? { cols: baselineSnapshot.cols, rows: baselineSnapshot.rows }
        : (canonicalInitialGeometry ?? null)
      if (!canonicalGeometry) {
        return Promise.resolve(null)
      }

      lastCommittedPtySizeRef.current = canonicalGeometry
      return Promise.resolve({ ...canonicalGeometry, changed: false })
    }

    return commitInitialTerminalNodeGeometry({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastCommittedPtySizeRef,
      sessionId,
      reason: 'frame_commit',
    })
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
