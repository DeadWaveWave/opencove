import type { Terminal } from '@xterm/xterm'
import { finalizeTerminalHydration } from './finalizeHydration'
import { isAutomaticTerminalQuery } from './inputClassification'
import {
  containsDestructiveTerminalDisplayControlSequence,
  containsMeaningfulTerminalDisplayContent,
  shouldDeferHydratedTerminalRedrawChunk,
  shouldReplacePlaceholderWithBufferedOutput,
} from './hydrationReplacement'
import { resolveSuffixPrefixOverlap } from './overlap'

export interface TerminalHydrationRouter {
  handleDataChunk: (data: string) => void
  handleExit: (exitCode: number) => void
  finalizeHydration: (rawSnapshot: string) => void
}

export function createTerminalHydrationRouter({
  terminal,
  outputScheduler,
  shouldReplaceAgentPlaceholderAfterHydration,
  shouldDeferHydratedRedrawChunks,
  hasRecentUserInteraction,
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
  shouldReplaceAgentPlaceholderAfterHydration: () => boolean
  shouldDeferHydratedRedrawChunks: () => boolean
  hasRecentUserInteraction: () => boolean
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
  const deferredPlaceholderBuffer = { dataChunks: [] as string[], exitCode: null as number | null }
  let shouldReplaceAgentPlaceholderOnNextVisibleChunk = false
  let shouldReplaceAgentPlaceholderOnNextDestructiveChunk = false
  const deferredHydratedRedrawBuffer = {
    dataChunks: [] as string[],
    exitCode: null as number | null,
  }
  let deferredHydratedRedrawTimeout: ReturnType<typeof setTimeout> | null = null

  const resetAgentPlaceholder = (): void => {
    terminal.reset()
    scrollbackBuffer.set('')
    committedScrollbackBuffer.set('')
    recordCommittedScreenState('')
    scheduleTranscriptSync()
  }

  const flushDeferredPlaceholderReplacement = (): void => {
    if (
      deferredPlaceholderBuffer.dataChunks.length === 0 &&
      deferredPlaceholderBuffer.exitCode === null
    ) {
      return
    }

    resetAgentPlaceholder()
    const bufferedData = deferredPlaceholderBuffer.dataChunks.join('')
    if (bufferedData.length > 0) {
      outputScheduler.handleChunk(bufferedData)
    }

    if (deferredPlaceholderBuffer.exitCode !== null) {
      outputScheduler.handleChunk(
        `\r\n[process exited with code ${deferredPlaceholderBuffer.exitCode}]\r\n`,
        {
          immediateScrollbackPublish: true,
        },
      )
    }

    deferredPlaceholderBuffer.dataChunks.length = 0
    deferredPlaceholderBuffer.exitCode = null
  }

  const flushDeferredHydratedRedraw = (): void => {
    if (
      deferredHydratedRedrawBuffer.dataChunks.length === 0 &&
      deferredHydratedRedrawBuffer.exitCode === null
    ) {
      return
    }

    if (deferredHydratedRedrawTimeout) {
      clearTimeout(deferredHydratedRedrawTimeout)
      deferredHydratedRedrawTimeout = null
    }

    const bufferedData = deferredHydratedRedrawBuffer.dataChunks.join('')
    if (bufferedData.length > 0) {
      outputScheduler.handleChunk(bufferedData)
    }

    if (deferredHydratedRedrawBuffer.exitCode !== null) {
      outputScheduler.handleChunk(
        `\r\n[process exited with code ${deferredHydratedRedrawBuffer.exitCode}]\r\n`,
        {
          immediateScrollbackPublish: true,
        },
      )
    }

    deferredHydratedRedrawBuffer.dataChunks.length = 0
    deferredHydratedRedrawBuffer.exitCode = null
  }

  const scheduleDeferredHydratedRedrawFlush = (): void => {
    if (deferredHydratedRedrawTimeout) {
      return
    }

    deferredHydratedRedrawTimeout = setTimeout(() => {
      deferredHydratedRedrawTimeout = null
      if (isDisposed()) {
        return
      }
      flushDeferredHydratedRedraw()
    }, 2_000)
  }

  return {
    handleDataChunk: data => {
      if (isHydrating) {
        hydrationBuffer.dataChunks.push(data)
        return
      }

      if (isAutomaticTerminalQuery(data)) {
        outputScheduler.handleChunk(data)
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextVisibleChunk) {
        deferredPlaceholderBuffer.dataChunks.push(data)
        if (
          !shouldReplacePlaceholderWithBufferedOutput({
            data,
            exitCode: null,
          })
        ) {
          return
        }

        shouldReplaceAgentPlaceholderOnNextVisibleChunk = false
        flushDeferredPlaceholderReplacement()
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextDestructiveChunk) {
        if (!containsDestructiveTerminalDisplayControlSequence(data)) {
          outputScheduler.handleChunk(data)
          return
        }

        shouldReplaceAgentPlaceholderOnNextDestructiveChunk = false
        shouldReplaceAgentPlaceholderOnNextVisibleChunk = true
        deferredPlaceholderBuffer.dataChunks.push(data)
        if (
          !shouldReplacePlaceholderWithBufferedOutput({
            data,
            exitCode: null,
          })
        ) {
          return
        }

        shouldReplaceAgentPlaceholderOnNextVisibleChunk = false
        flushDeferredPlaceholderReplacement()
        return
      }

      if (deferredHydratedRedrawBuffer.dataChunks.length > 0) {
        deferredHydratedRedrawBuffer.dataChunks.push(data)
        if (
          hasRecentUserInteraction() ||
          !shouldReplacePlaceholderWithBufferedOutput({
            data,
            exitCode: null,
          })
        ) {
          if (!hasRecentUserInteraction()) {
            return
          }
        }

        flushDeferredHydratedRedraw()
        return
      }

      if (
        shouldDeferHydratedRedrawChunks() &&
        !hasRecentUserInteraction() &&
        (shouldDeferHydratedTerminalRedrawChunk(data) ||
          (data.includes('\u001b') && !containsMeaningfulTerminalDisplayContent(data)))
      ) {
        deferredHydratedRedrawBuffer.dataChunks.push(data)
        scheduleDeferredHydratedRedrawFlush()
        return
      }

      outputScheduler.handleChunk(data)
    },
    handleExit: exitCode => {
      if (isHydrating) {
        hydrationBuffer.exitCode = exitCode
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextVisibleChunk) {
        deferredPlaceholderBuffer.exitCode = exitCode
        shouldReplaceAgentPlaceholderOnNextVisibleChunk = false
        flushDeferredPlaceholderReplacement()
        return
      }

      if (deferredHydratedRedrawBuffer.dataChunks.length > 0) {
        deferredHydratedRedrawBuffer.exitCode = exitCode
        flushDeferredHydratedRedraw()
        return
      }

      outputScheduler.handleChunk(`\r\n[process exited with code ${exitCode}]\r\n`, {
        immediateScrollbackPublish: true,
      })
    },
    finalizeHydration: rawSnapshot => {
      isHydrating = false
      const bufferedData = hydrationBuffer.dataChunks.join('')
      const shouldReplacePlaceholder = shouldReplaceAgentPlaceholderAfterHydration()
      const shouldReplaceBufferedPlaceholder =
        shouldReplacePlaceholder &&
        shouldReplacePlaceholderWithBufferedOutput({
          data: bufferedData,
          exitCode: hydrationBuffer.exitCode,
        })
      const shouldDeferBufferedReplay =
        shouldReplacePlaceholder && !shouldReplaceBufferedPlaceholder
      const bufferedOutputAlreadyMatchesPlaceholder =
        shouldReplaceBufferedPlaceholder &&
        hydrationBuffer.exitCode === null &&
        bufferedData.length > 0 &&
        resolveSuffixPrefixOverlap(rawSnapshot, bufferedData) === bufferedData.length
      const bufferedDataChunksForFinalize = shouldDeferBufferedReplay
        ? []
        : hydrationBuffer.dataChunks
      const bufferedExitCodeForFinalize = shouldDeferBufferedReplay
        ? null
        : hydrationBuffer.exitCode

      const didReplaceBaseline = finalizeTerminalHydration({
        isDisposed,
        rawSnapshot,
        replaceHydrationSnapshotWithBufferedOutput: shouldReplaceBufferedPlaceholder,
        scrollbackBuffer,
        ptyWriteQueue,
        bufferedDataChunks: bufferedDataChunksForFinalize,
        bufferedExitCode: bufferedExitCodeForFinalize,
        terminal,
        committedScrollbackBuffer,
        onCommittedScreenState: recordCommittedScreenState,
        markScrollbackDirty,
        logHydrated,
        syncTerminalSize,
        onRevealed,
      })

      if (shouldReplacePlaceholder && !didReplaceBaseline) {
        if (bufferedOutputAlreadyMatchesPlaceholder) {
          shouldReplaceAgentPlaceholderOnNextDestructiveChunk = true
        } else {
          deferredPlaceholderBuffer.dataChunks.push(...hydrationBuffer.dataChunks)
          deferredPlaceholderBuffer.exitCode = hydrationBuffer.exitCode
          shouldReplaceAgentPlaceholderOnNextVisibleChunk = true
        }
      }

      hydrationBuffer.dataChunks.length = 0
      hydrationBuffer.exitCode = null
    },
  }
}
