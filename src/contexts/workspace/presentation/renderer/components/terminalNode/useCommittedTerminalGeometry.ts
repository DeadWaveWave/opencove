import { useCallback, type MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import {
  commitSettledTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
} from './syncTerminalNodeSize'
import {
  beginTerminalGeometryCommit,
  isTerminalGeometryCommitCurrent,
  markTerminalGeometryCommitSettled,
} from './terminalGeometryCoordinator'

type PtySize = { cols: number; rows: number }

type CommittedTerminalGeometryParams = {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  suppressPtyResizeRef: MutableRefObject<boolean>
  latestSessionIdRef: MutableRefObject<string>
  sessionId: string
  scheduleWebglCanvasTransformCleanup: () => void
}

export type CommitTerminalGeometryReason = Extract<
  TerminalGeometryCommitReason,
  'frame_commit' | 'appearance_commit'
>

export async function commitTerminalGeometryForCurrentSession(
  {
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    suppressPtyResizeRef,
    latestSessionIdRef,
    sessionId,
    scheduleWebglCanvasTransformCleanup,
  }: CommittedTerminalGeometryParams,
  reason: CommitTerminalGeometryReason,
): Promise<void> {
  const terminal = terminalRef.current
  if (suppressPtyResizeRef.current || sessionId.trim().length === 0) {
    fitTerminalNodeToMeasuredSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
    })
    return
  }

  const committedSessionId = sessionId
  const geometryRevision = terminal ? beginTerminalGeometryCommit(terminal) : null
  const pendingCommittedPtySizeRef: MutableRefObject<PtySize | null> = {
    current: lastCommittedPtySizeRef.current,
  }

  await commitSettledTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef: pendingCommittedPtySizeRef,
    sessionId,
    reason,
    geometryRevision,
    shouldCommit: () => latestSessionIdRef.current === committedSessionId,
  })

  if (latestSessionIdRef.current !== committedSessionId) {
    if (terminal && geometryRevision !== null) {
      markTerminalGeometryCommitSettled(terminal, geometryRevision)
    }
    return
  }

  if (
    terminal &&
    geometryRevision !== null &&
    !isTerminalGeometryCommitCurrent(terminal, geometryRevision)
  ) {
    return
  }

  lastCommittedPtySizeRef.current = pendingCommittedPtySizeRef.current
  if (terminal && geometryRevision !== null) {
    markTerminalGeometryCommitSettled(terminal, geometryRevision)
  }
  scheduleWebglCanvasTransformCleanup()
}

export function useCommittedTerminalGeometry(
  params: CommittedTerminalGeometryParams,
): (reason: CommitTerminalGeometryReason) => void {
  const {
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    suppressPtyResizeRef,
    latestSessionIdRef,
    sessionId,
    scheduleWebglCanvasTransformCleanup,
  } = params

  return useCallback(
    (reason: CommitTerminalGeometryReason) => {
      void commitTerminalGeometryForCurrentSession(
        {
          terminalRef,
          fitAddonRef,
          containerRef,
          isPointerResizingRef,
          lastCommittedPtySizeRef,
          suppressPtyResizeRef,
          latestSessionIdRef,
          sessionId,
          scheduleWebglCanvasTransformCleanup,
        },
        reason,
      )
    },
    [
      containerRef,
      fitAddonRef,
      isPointerResizingRef,
      lastCommittedPtySizeRef,
      latestSessionIdRef,
      scheduleWebglCanvasTransformCleanup,
      sessionId,
      suppressPtyResizeRef,
      terminalRef,
    ],
  )
}
