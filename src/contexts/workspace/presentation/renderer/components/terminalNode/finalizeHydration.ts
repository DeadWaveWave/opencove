import { revealHydratedTerminal } from './revealHydratedTerminal'
import { resolveSuffixPrefixOverlap } from './overlap'
import { replayBufferedHydrationOutput } from './replayBufferedHydrationOutput'

export function finalizeTerminalHydration({
  isDisposed,
  rawSnapshot,
  replaceHydrationSnapshotWithBufferedOutput = false,
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
  onReplayWriteCommitted,
  onRevealed,
}: {
  isDisposed: () => boolean
  rawSnapshot: string
  replaceHydrationSnapshotWithBufferedOutput?: boolean
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
  committedScrollbackBuffer: {
    set: (snapshot: string) => void
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
  markScrollbackDirty: (immediate?: boolean) => void
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  syncTerminalSize: () => void
  onReplayWriteCommitted?: () => void
  onRevealed: () => void
}): boolean {
  if (isDisposed()) {
    return false
  }

  const bufferedData = bufferedDataChunks.join('')
  bufferedDataChunks.length = 0

  const bufferedOverlap = resolveSuffixPrefixOverlap(rawSnapshot, bufferedData)
  const bufferedRemainder = bufferedData.slice(bufferedOverlap)
  const shouldReplaceBaseline =
    replaceHydrationSnapshotWithBufferedOutput &&
    (bufferedRemainder.length > 0 || bufferedExitCode !== null)
  const baselineSnapshot = shouldReplaceBaseline ? '' : rawSnapshot

  if (shouldReplaceBaseline) {
    // Agent CLIs can replay their own full history on resume. If we already rendered a durable
    // placeholder snapshot, keep it visible until the PTY produces real output, then replace it
    // with the resumed output to avoid double-rendered history.
    scrollbackBuffer.set('')
    committedScrollbackBuffer.set('')
  } else {
    scrollbackBuffer.set(rawSnapshot)
  }

  ptyWriteQueue.flush()

  replayBufferedHydrationOutput({
    terminal,
    rawSnapshot: baselineSnapshot,
    bufferedData,
    bufferedExitCode,
    resetTerminalBeforeFirstWrite: shouldReplaceBaseline,
    scrollbackBuffer,
    committedScrollbackBuffer,
    onCommittedScreenState,
    onReplayWriteCommitted,
  })

  markScrollbackDirty(true)
  logHydrated({
    rawSnapshotLength: baselineSnapshot.length,
    bufferedExitCode,
  })
  revealHydratedTerminal(syncTerminalSize, onRevealed)

  return shouldReplaceBaseline
}
