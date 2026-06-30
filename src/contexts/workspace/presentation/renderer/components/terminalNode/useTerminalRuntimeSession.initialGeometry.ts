import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult, TerminalPtyGeometry } from '@shared/contracts/dto'
import type { AgentLaunchMode } from '../../types'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { commitInitialTerminalNodeGeometry, refreshTerminalNodeSize } from './syncTerminalNodeSize'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import type { CachedTerminalScreenState } from './screenStateCache'
import type { XtermSession } from './xtermSession'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'
import {
  beginTerminalGeometryCommit,
  markTerminalGeometryAccepted,
  markTerminalGeometryCommitSettled,
} from './terminalGeometryCoordinator'

type PtySize = { cols: number; rows: number }

export function shouldPreferMeasuredInitialGeometryCommit({
  kind,
  isLiveSessionReattach,
  canonicalInitialGeometry,
  suppressPtyResize,
  agentResumeSessionIdVerified = false,
  agentLaunchMode = null,
}: {
  kind: 'terminal' | 'agent' | string
  isLiveSessionReattach: boolean
  canonicalInitialGeometry: PtySize | null
  suppressPtyResize: boolean
  agentResumeSessionIdVerified?: boolean
  agentLaunchMode?: AgentLaunchMode | null
}): boolean {
  if (suppressPtyResize) {
    return false
  }

  const isRestoredAgentRuntime =
    kind === 'agent' &&
    !isLiveSessionReattach &&
    (agentResumeSessionIdVerified || agentLaunchMode === 'resume')
  if (isRestoredAgentRuntime) {
    return false
  }

  if (kind === 'agent') {
    return true
  }

  return !isLiveSessionReattach && kind === 'terminal' && canonicalInitialGeometry === null
}

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
    resizeTerminalPreservingScrollState(terminal, geometry.cols, geometry.rows)
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
      const terminal = terminalRef.current
      if (terminal) {
        markTerminalGeometryAccepted(terminal, baselineSnapshot?.geometryRevision)
      }
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
      const terminal = terminalRef.current
      if (terminal) {
        markTerminalGeometryAccepted(terminal, baselineSnapshot?.geometryRevision)
      }
      return { ...canonicalGeometry, changed: false }
    }

    if (canonicalGeometry) {
      lastCommittedPtySizeRef.current = canonicalGeometry
    }

    const terminal = terminalRef.current
    const geometryRevision = terminal ? beginTerminalGeometryCommit(terminal) : null
    const measuredGeometry = await commitInitialTerminalNodeGeometry({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastCommittedPtySizeRef,
      sessionId,
      reason: 'frame_commit',
      geometryRevision,
    })

    if (measuredGeometry) {
      if (terminal && geometryRevision !== null) {
        markTerminalGeometryCommitSettled(terminal, geometryRevision)
      }
      return measuredGeometry
    }

    if (terminal) {
      markTerminalGeometryAccepted(terminal, geometryRevision)
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
