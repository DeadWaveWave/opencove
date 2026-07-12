import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'
import { refreshTerminalNodeSize } from './terminalGeometryLayout'
import type { InitialTerminalNodeGeometryCommitResult, PtySize } from './terminalGeometryTypes'
import { recordTerminalGeometryCommitResult } from './terminalGeometryCoordinator'
import { requestTerminalGeometryCommitAck } from './terminalGeometryCommitAck'
import { resolveStableMeasuredTerminalNodeGeometry } from './terminalGeometryStableMeasurement'

export { fitTerminalNodeToMeasuredSize } from './terminalGeometryFit'
export { refreshTerminalNodeSize } from './terminalGeometryLayout'
export type { InitialTerminalNodeGeometryCommitResult } from './terminalGeometryTypes'

export async function commitTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
}): Promise<void> {
  await commitSettledTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    sessionId,
    reason,
    geometryRevision,
  })
}

async function commitMeasuredTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
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
  geometryRevision?: number | null
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

  const alreadyCommitted =
    lastCommittedPtySizeRef.current?.cols === nextPtySize.cols &&
    lastCommittedPtySizeRef.current.rows === nextPtySize.rows

  if (alreadyCommitted) {
    applyTerminalNodeGeometryLocally({
      terminalRef,
      containerRef,
      isPointerResizingRef,
      size: nextPtySize,
    })
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

  const terminal = terminalRef.current
  const { revision, result } = await requestTerminalGeometryCommitAck({
    terminal,
    sessionId,
    cols: nextPtySize.cols,
    rows: nextPtySize.rows,
    reason,
    geometryRevision,
  })

  if (
    terminal &&
    revision !== null &&
    !recordTerminalGeometryCommitResult(terminal, revision, result)
  ) {
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
      skippedReason: 'stale-session-after-resize',
    })
    return null
  }

  const canonicalGeometry = result.geometry
  if (!canonicalGeometry) {
    return null
  }

  const canonicalPtySize = {
    cols: canonicalGeometry.cols,
    rows: canonicalGeometry.rows,
  }
  applyTerminalNodeGeometryLocally({
    terminalRef,
    containerRef,
    isPointerResizingRef,
    size: canonicalPtySize,
  })
  lastCommittedPtySizeRef.current = canonicalPtySize
  logTerminalGeometryDiagnostics({
    event: result.status === 'accepted' && result.changed ? commitEvent : unchangedEvent,
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
    container: containerRef.current,
    sessionId,
    reason,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    nextPtySize: canonicalPtySize,
  })
  return {
    ...canonicalPtySize,
    changed: result.status === 'accepted' && result.changed,
  }
}

function applyTerminalNodeGeometryLocally({
  terminalRef,
  containerRef,
  isPointerResizingRef,
  size,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  size: PtySize
}): void {
  const terminal = terminalRef.current
  if (!terminal) {
    return
  }

  if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
    resizeTerminalPreservingScrollState(terminal, size.cols, size.rows)
  }

  refreshTerminalNodeSize({ terminalRef, containerRef, isPointerResizingRef })
}

export async function commitSettledTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
  shouldCommit,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
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
    geometryRevision,
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
  geometryRevision,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
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
    geometryRevision,
    nextPtySize,
    commitEvent: 'geometry-initial-commit-resized',
    skippedEvent: 'geometry-initial-commit-skipped',
    unchangedEvent: 'geometry-initial-commit-unchanged',
  })
}
