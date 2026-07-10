import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '@shared/contracts/dto'
import type { WorkspaceNodeKind } from '../../types'
import type { CachedTerminalScreenState } from './screenStateCache'
import {
  restoreTerminalScrollState,
  type TerminalScrollStateSnapshot,
} from './effectiveDevicePixelRatio'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'
import type { RuntimeTerminalInputBridge } from './createRuntimeTerminalInputBridge'
import type { TerminalHydrationRouter } from './hydrationRouter'
import { markTerminalGeometryAccepted } from './terminalGeometryCoordinator'

export function startRuntimeTerminalHydration({
  attachPromise,
  sessionId,
  terminal,
  kind,
  isLiveSessionReattach,
  shouldSkipInitialPlaceholderWrite,
  cachedScreenState,
  scrollbackBuffer,
  committedScrollbackBuffer,
  committedScreenStateRecorder,
  scheduleTranscriptSync,
  presentationSnapshotPromise,
  hydrationBaselineSourceRef,
  lastCommittedPtySizeRef,
  runtimeInputBridge,
  hydrationRouter,
  scrollStateToRestore,
  onScrollStateRestored,
  onHydrated,
  onPresentationSnapshotGeometryApplied,
  shouldGateInitialUserInput,
  shouldAwaitAgentVisibleOutput,
  isDisposed,
}: {
  attachPromise: Promise<void | undefined>
  sessionId: string
  terminal: Terminal
  kind: WorkspaceNodeKind
  isLiveSessionReattach: boolean
  shouldSkipInitialPlaceholderWrite: boolean
  cachedScreenState: CachedTerminalScreenState | null
  scrollbackBuffer: { snapshot: () => string }
  committedScrollbackBuffer: { set: (rawSnapshot: string) => void }
  committedScreenStateRecorder: { record: (rawSnapshot: string) => void }
  scheduleTranscriptSync: () => void
  presentationSnapshotPromise: Promise<PresentationSnapshotTerminalResult | null>
  hydrationBaselineSourceRef: MutableRefObject<TerminalHydrationBaselineSource>
  lastCommittedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  runtimeInputBridge: RuntimeTerminalInputBridge
  hydrationRouter: TerminalHydrationRouter
  scrollStateToRestore: TerminalScrollStateSnapshot | null
  onScrollStateRestored?: () => void
  onHydrated?: () => void
  onPresentationSnapshotGeometryApplied?: () => void
  shouldGateInitialUserInput: boolean
  shouldAwaitAgentVisibleOutput: boolean
  isDisposed: () => boolean
}): void {
  void hydrateTerminalFromSnapshot({
    attachPromise,
    sessionId,
    terminal,
    kind: kind === 'agent' ? 'agent' : 'terminal',
    useLivePtySnapshotDuringHydration: kind !== 'agent' || isLiveSessionReattach,
    runtimeEpochChanged: !isLiveSessionReattach,
    skipInitialPlaceholderWrite: shouldSkipInitialPlaceholderWrite,
    cachedScreenState,
    persistedSnapshot: kind === 'agent' ? '' : scrollbackBuffer.snapshot(),
    presentationSnapshotPromise,
    takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
    scrollStateToRestore,
    isDisposed,
    onHydratedWriteCommitted: rawSnapshot => {
      committedScrollbackBuffer.set(rawSnapshot)
      committedScreenStateRecorder.record(rawSnapshot)
      scheduleTranscriptSync()
    },
    onHydrationBaselineResolved: source => {
      hydrationBaselineSourceRef.current = source
    },
    onPresentationSnapshotGeometryApplied,
    onPresentationSnapshotAccepted: snapshot => {
      lastCommittedPtySizeRef.current = {
        cols: snapshot.cols,
        rows: snapshot.rows,
      }
      markTerminalGeometryAccepted(terminal, snapshot.geometryRevision)
    },
    finalizeHydration: (rawSnapshot, options) => {
      runtimeInputBridge.handlePtyOutputChunk(rawSnapshot)
      runtimeInputBridge.enableTerminalDataForwarding()
      hydrationRouter.finalizeHydration(rawSnapshot, {
        baselineAppliedSeq: options?.baselineAppliedSeq ?? null,
      })
      if (options?.scrollStateToRestore) {
        restoreTerminalScrollState(terminal, options.scrollStateToRestore)
      }
      onScrollStateRestored?.()
      onHydrated?.()
      if (shouldGateInitialUserInput) {
        if (shouldAwaitAgentVisibleOutput) {
          return
        }
        window.setTimeout(() => {
          if (!isDisposed()) {
            runtimeInputBridge.releaseBufferedUserInput()
          }
        }, 1_000)
        return
      }
      runtimeInputBridge.releaseBufferedUserInput()
    },
  })
}
