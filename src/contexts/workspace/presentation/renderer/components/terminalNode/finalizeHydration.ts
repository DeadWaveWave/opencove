import { revealHydratedTerminal } from './revealHydratedTerminal'
import { replayBufferedHydrationOutput } from './replayBufferedHydrationOutput'

export function finalizeTerminalHydration({
  isDisposed,
  rawSnapshot,
  scrollbackBuffer,
  ptyWriteQueue,
  bufferedDataChunks,
  bufferedExitCode,
  terminal,
  committedScrollbackBuffer,
  onCommittedScreenState,
  markScrollbackDirty,
  logHydrated,
  syncTerminalSize,
  onRevealed,
}: {
  isDisposed: () => boolean
  rawSnapshot: string
  scrollbackBuffer: {
    set: (snapshot: string) => void
    append: (data: string) => void
  }
  ptyWriteQueue: {
    flush: () => void
  }
  bufferedDataChunks: string[]
  bufferedExitCode: number | null
  terminal: Parameters<typeof replayBufferedHydrationOutput>[0]['terminal']
  committedScrollbackBuffer: Parameters<
    typeof replayBufferedHydrationOutput
  >[0]['committedScrollbackBuffer']
  onCommittedScreenState: (rawSnapshot: string) => void
  markScrollbackDirty: (immediate?: boolean) => void
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  syncTerminalSize: () => void
  onRevealed: () => void
}): void {
  if (isDisposed()) {
    return
  }

  scrollbackBuffer.set(rawSnapshot)
  ptyWriteQueue.flush()

  const bufferedData = bufferedDataChunks.join('')
  bufferedDataChunks.length = 0

  replayBufferedHydrationOutput({
    terminal,
    rawSnapshot,
    bufferedData,
    bufferedExitCode,
    scrollbackBuffer,
    committedScrollbackBuffer,
    onCommittedScreenState,
  })

  markScrollbackDirty(true)
  logHydrated({
    rawSnapshotLength: rawSnapshot.length,
    bufferedExitCode,
  })
  revealHydratedTerminal(syncTerminalSize, onRevealed)
}
