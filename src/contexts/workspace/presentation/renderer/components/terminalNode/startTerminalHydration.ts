import { finalizeTerminalHydration } from './finalizeHydration'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import type { RollingTextBuffer } from '../../utils/rollingTextBuffer'

export function startTerminalHydration({
  attachPromise,
  cachedScreenState,
  committedScrollbackBuffer,
  hydrationBuffer,
  isDisposed,
  logHydrated,
  markScrollbackDirty,
  onBeforeFinalize,
  onCommittedScreenState,
  onHydratedWriteCommitted,
  onRevealed,
  persistedSnapshot,
  ptyWriteQueue,
  scheduleTranscriptSync,
  sessionId,
  scrollbackBuffer,
  syncTerminalSize,
  takePtySnapshot,
  terminal,
}: {
  attachPromise: Parameters<typeof hydrateTerminalFromSnapshot>[0]['attachPromise']
  cachedScreenState: Parameters<typeof hydrateTerminalFromSnapshot>[0]['cachedScreenState']
  committedScrollbackBuffer: RollingTextBuffer
  hydrationBuffer: { dataChunks: string[]; exitCode: number | null }
  isDisposed: () => boolean
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  markScrollbackDirty: () => void
  onBeforeFinalize?: () => void
  onCommittedScreenState: (rawSnapshot: string) => void
  onHydratedWriteCommitted: (rawSnapshot: string) => void
  onRevealed: () => void
  persistedSnapshot: string
  ptyWriteQueue: {
    enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
    flush: () => void
  }
  scheduleTranscriptSync: () => void
  sessionId: string
  scrollbackBuffer: RollingTextBuffer
  syncTerminalSize: () => void
  takePtySnapshot: Parameters<typeof hydrateTerminalFromSnapshot>[0]['takePtySnapshot']
  terminal: Parameters<typeof hydrateTerminalFromSnapshot>[0]['terminal']
}): { finalizeHydration: (rawSnapshot: string) => void } {
  const finalizeHydration = (rawSnapshot: string): void => {
    onBeforeFinalize?.()
    finalizeTerminalHydration({
      isDisposed,
      rawSnapshot,
      scrollbackBuffer,
      ptyWriteQueue,
      bufferedDataChunks: hydrationBuffer.dataChunks,
      bufferedExitCode: hydrationBuffer.exitCode,
      terminal,
      committedScrollbackBuffer,
      onCommittedScreenState,
      markScrollbackDirty,
      logHydrated,
      syncTerminalSize,
      onRevealed: () => {
        onRevealed()
        scheduleTranscriptSync()
      },
    })
    hydrationBuffer.exitCode = null
  }

  void hydrateTerminalFromSnapshot({
    attachPromise,
    sessionId,
    terminal,
    cachedScreenState,
    persistedSnapshot,
    takePtySnapshot,
    isDisposed,
    onHydratedWriteCommitted,
    finalizeHydration,
  })

  return { finalizeHydration }
}
