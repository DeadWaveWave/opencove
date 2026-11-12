import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type {
  AttachTerminalResult,
  PresentationSnapshotTerminalResult,
} from '@shared/contracts/dto'
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
import { createTerminalHydrationLifecycle } from './terminalHydrationLifecycle'
import { requestPresentationSnapshot } from './presentationSnapshotGeometry'

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
  attachPromise: Promise<AttachTerminalResult | undefined>
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
}): () => void {
  let cancelled = false
  let inputReleaseTimer: ReturnType<typeof setTimeout> | null = null
  const inactive = () => cancelled || isDisposed()
  const hydrate = (snapshotPromise: Promise<PresentationSnapshotTerminalResult | null>) =>
    hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId,
      terminal,
      kind: kind === 'agent' ? 'agent' : 'terminal',
      useLivePtySnapshotDuringHydration: kind !== 'agent' || isLiveSessionReattach,
      runtimeEpochChanged: !isLiveSessionReattach,
      skipInitialPlaceholderWrite: shouldSkipInitialPlaceholderWrite,
      cachedScreenState,
      persistedSnapshot: kind === 'agent' ? '' : scrollbackBuffer.snapshot(),
      presentationSnapshotPromise: snapshotPromise,
      takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
      scrollStateToRestore,
      isDisposed: inactive,
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
      },
      finalizeHydration: (rawSnapshot, options) => {
        runtimeInputBridge.hydratePtyOutputSnapshot(rawSnapshot)
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
          inputReleaseTimer = setTimeout(() => {
            inputReleaseTimer = null
            if (!inactive()) {
              runtimeInputBridge.releaseBufferedUserInput()
            }
          }, 1_000)
          return
        }
        runtimeInputBridge.releaseBufferedUserInput()
      },
    })
  const lifecycle = createTerminalHydrationLifecycle({
    terminal,
    isDisposed: inactive,
    attempt: async retry => {
      if (!retry) {
        return hydrate(presentationSnapshotPromise)
      }
      const snapshot = await requestPresentationSnapshot(sessionId)
      if (inactive()) {
        return 'disposed'
      }
      // An exhausted authoritative attempt must not downgrade to raw/empty
      // fallback if a later refetch temporarily has no checkpoint.
      return snapshot && snapshot.serializedScreen.length > 0
        ? hydrate(Promise.resolve(snapshot))
        : 'retryable'
    },
  })
  lifecycle.start()
  return () => {
    cancelled = true
    lifecycle.dispose()
    if (inputReleaseTimer !== null) {
      clearTimeout(inputReleaseTimer)
      inputReleaseTimer = null
    }
  }
}
