import { useCallback, useRef, type MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import {
  commitSettledTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
  refreshTerminalNodeSize,
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
  if (sessionId.trim().length === 0) {
    fitTerminalNodeToMeasuredSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
    })
    return
  }

  if (suppressPtyResizeRef.current) {
    refreshTerminalNodeSize({
      terminalRef,
      containerRef,
      isPointerResizingRef,
    })
    scheduleWebglCanvasTransformCleanup()
    return
  }

  const committedSessionId = sessionId
  const geometryRevision = terminal ? beginTerminalGeometryCommit(terminal) : null
  const pendingCommittedPtySizeRef: MutableRefObject<PtySize | null> = {
    current: lastCommittedPtySizeRef.current,
  }

  try {
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
  } catch {
    if (terminal && geometryRevision !== null) {
      markTerminalGeometryCommitSettled(terminal, geometryRevision)
    }
    return
  }

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
  const commitQueueRef = useRef<{
    sessionId: string
    terminal: Terminal | null
    chain: Promise<void>
  } | null>(null)

  return useCallback(
    (reason: CommitTerminalGeometryReason) => {
      const currentTerminal = terminalRef.current
      if (
        commitQueueRef.current?.sessionId !== sessionId ||
        commitQueueRef.current.terminal !== currentTerminal
      ) {
        commitQueueRef.current = {
          sessionId,
          terminal: currentTerminal,
          chain: Promise.resolve(),
        }
      }
      const queue = commitQueueRef.current
      const commit = () =>
        commitTerminalGeometryForCurrentSession(
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
      queue.chain = queue.chain.then(commit, commit)
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
