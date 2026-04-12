import type { Terminal } from '@xterm/xterm'
import { finalizeTerminalHydration } from './finalizeHydration'

export interface TerminalHydrationRouter {
  handleDataChunk: (data: string) => void
  handleExit: (exitCode: number) => void
  finalizeHydration: (rawSnapshot: string) => void
}

export function createTerminalHydrationRouter({
  terminal,
  outputScheduler,
  shouldReplaceAgentPlaceholderAfterHydration,
  scrollbackBuffer,
  committedScrollbackBuffer,
  recordCommittedScreenState,
  scheduleTranscriptSync,
  ptyWriteQueue,
  markScrollbackDirty,
  logHydrated,
  syncTerminalSize,
  onRevealed,
  isDisposed,
}: {
  terminal: Terminal
  outputScheduler: {
    handleChunk: (data: string, options?: { immediateScrollbackPublish?: boolean }) => void
  }
  shouldReplaceAgentPlaceholderAfterHydration: boolean
  scrollbackBuffer: {
    set: (snapshot: string) => void
    append: (data: string) => void
  }
  committedScrollbackBuffer: {
    set: (snapshot: string) => void
    append: (data: string) => void
    snapshot: () => string
  }
  recordCommittedScreenState: (rawSnapshot: string) => void
  scheduleTranscriptSync: () => void
  ptyWriteQueue: {
    flush: () => void
  }
  markScrollbackDirty: (immediate?: boolean) => void
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  syncTerminalSize: () => void
  onRevealed: () => void
  isDisposed: () => boolean
}): TerminalHydrationRouter {
  let isHydrating = true
  const hydrationBuffer = { dataChunks: [] as string[], exitCode: null as number | null }
  let shouldReplaceAgentPlaceholderOnNextChunk = false

  const resetAgentPlaceholder = (): void => {
    terminal.reset()
    scrollbackBuffer.set('')
    committedScrollbackBuffer.set('')
    recordCommittedScreenState('')
    scheduleTranscriptSync()
  }

  return {
    handleDataChunk: data => {
      if (isHydrating) {
        hydrationBuffer.dataChunks.push(data)
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextChunk) {
        shouldReplaceAgentPlaceholderOnNextChunk = false
        resetAgentPlaceholder()
      }

      outputScheduler.handleChunk(data)
    },
    handleExit: exitCode => {
      if (isHydrating) {
        hydrationBuffer.exitCode = exitCode
        return
      }

      outputScheduler.handleChunk(`\r\n[process exited with code ${exitCode}]\r\n`, {
        immediateScrollbackPublish: true,
      })
    },
    finalizeHydration: rawSnapshot => {
      isHydrating = false

      const didReplaceBaseline = finalizeTerminalHydration({
        isDisposed,
        rawSnapshot,
        replaceHydrationSnapshotWithBufferedOutput: shouldReplaceAgentPlaceholderAfterHydration,
        scrollbackBuffer,
        ptyWriteQueue,
        bufferedDataChunks: hydrationBuffer.dataChunks,
        bufferedExitCode: hydrationBuffer.exitCode,
        terminal,
        committedScrollbackBuffer,
        onCommittedScreenState: recordCommittedScreenState,
        markScrollbackDirty,
        logHydrated,
        syncTerminalSize,
        onRevealed,
      })

      if (shouldReplaceAgentPlaceholderAfterHydration && !didReplaceBaseline) {
        shouldReplaceAgentPlaceholderOnNextChunk = true
      }

      hydrationBuffer.exitCode = null
    },
  }
}
