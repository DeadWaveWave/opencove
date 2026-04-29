import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '@shared/contracts/dto'
import type { WorkspaceNodeKind } from '../../types'
import type { CachedTerminalScreenState } from './screenStateCache'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'
import type { RuntimeTerminalInputBridge } from './createRuntimeTerminalInputBridge'
import type { TerminalHydrationRouter } from './hydrationRouter'

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
    skipInitialPlaceholderWrite: shouldSkipInitialPlaceholderWrite,
    cachedScreenState,
    persistedSnapshot: kind === 'agent' ? '' : scrollbackBuffer.snapshot(),
    presentationSnapshotPromise,
    takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
    isDisposed,
    onHydratedWriteCommitted: rawSnapshot => {
      committedScrollbackBuffer.set(rawSnapshot)
      committedScreenStateRecorder.record(rawSnapshot)
      scheduleTranscriptSync()
    },
    onHydrationBaselineResolved: source => {
      hydrationBaselineSourceRef.current = source
    },
    onPresentationSnapshotAccepted: snapshot => {
      lastCommittedPtySizeRef.current = {
        cols: snapshot.cols,
        rows: snapshot.rows,
      }
    },
    finalizeHydration: (rawSnapshot, options) => {
      runtimeInputBridge.enableTerminalDataForwarding()
      hydrationRouter.finalizeHydration(rawSnapshot, options)
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
