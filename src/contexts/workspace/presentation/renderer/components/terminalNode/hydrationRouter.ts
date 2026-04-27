import type { Terminal } from '@xterm/xterm'
import { finalizeTerminalHydration } from './finalizeHydration'
import { isAutomaticTerminalQuery } from './inputClassification'
import { replayBufferedHydrationOutput } from './replayBufferedHydrationOutput'
import {
  containsDestructiveTerminalDisplayControlSequence,
  containsMeaningfulTerminalDisplayContent,
  endsWithIncompleteTerminalControlSequence,
  shouldDeferHydratedTerminalRedrawChunk,
  shouldReplacePlaceholderWithBufferedOutput,
  stripEchoedTerminalControlSequences,
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
  let shouldProtectHydratedControlOnlyRedraw = false
  let shouldProtectHydratedDestructiveRedraw = false
  let deferredHydratedRedrawTimeout: ReturnType<typeof setTimeout> | null = null

  const getDeferredHydratedRedrawData = (): string =>
    deferredHydratedRedrawBuffer.dataChunks.join('')

  const hasDeferredDestructiveHydratedRedraw = (): boolean =>
    containsDestructiveTerminalDisplayControlSequence(getDeferredHydratedRedrawData())

  const isControlOnlyTerminalChunk = (data: string): boolean =>
    data.length > 0 && !containsMeaningfulTerminalDisplayContent(data)

  const clearAgentPlaceholderState = (): void => {
    scrollbackBuffer.set('')
    committedScrollbackBuffer.set('')
  }

  const replaceAgentPlaceholderWithBufferedOutput = ({
    data,
    exitCode,
  }: {
    data: string
    exitCode: number | null
  }): void => {
    clearAgentPlaceholderState()
    replayBufferedHydrationOutput({
      terminal,
      rawSnapshot: '',
      bufferedData: data,
      bufferedExitCode: exitCode,
      resetTerminalBeforeFirstWrite: true,
      scrollbackBuffer,
      committedScrollbackBuffer,
      onCommittedScreenState: recordCommittedScreenState,
      onReplayWriteCommitted: scheduleTranscriptSync,
    })
    markScrollbackDirty(true)
    scheduleTranscriptSync()
  }

  const maybeFlushDeferredHydratedRedrawControlOnlyChunks = (): void => {
    const bufferedData = getDeferredHydratedRedrawData()
    if (
      hasDeferredDestructiveHydratedRedraw() ||
      endsWithIncompleteTerminalControlSequence(bufferedData)
    ) {
      return
    }

    if (!hasRecentUserInteraction()) {
      scheduleDeferredHydratedRedrawFlush()
    }
  }

  const settleHydratedControlOnlyProtectionFromData = (data: string): void => {
    if (!shouldProtectHydratedControlOnlyRedraw) {
      return
    }

    if (!containsMeaningfulTerminalDisplayContent(data)) {
      return
    }

    shouldProtectHydratedControlOnlyRedraw = false
  }

  const flushDeferredPlaceholderReplacement = (): void => {
    if (
      deferredPlaceholderBuffer.dataChunks.length === 0 &&
      deferredPlaceholderBuffer.exitCode === null
    ) {
      return
    }

    const bufferedData = deferredPlaceholderBuffer.dataChunks.join('')
    replaceAgentPlaceholderWithBufferedOutput({
      data: bufferedData,
      exitCode: deferredPlaceholderBuffer.exitCode,
    })

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

    const bufferedData = getDeferredHydratedRedrawData()
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
      if (hasDeferredDestructiveHydratedRedraw()) {
        return
      }
      flushDeferredHydratedRedraw()
    }, 2_000)
  }

  return {
    handleDataChunk: data => {
      const displayData = stripEchoedTerminalControlSequences(data)
      if (data.length > 0 && displayData.length === 0) {
        return
      }

      if (isHydrating) {
        hydrationBuffer.dataChunks.push(displayData)
        return
      }

      if (isAutomaticTerminalQuery(displayData)) {
        outputScheduler.handleChunk(displayData)
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextVisibleChunk) {
        deferredPlaceholderBuffer.dataChunks.push(displayData)
        if (
          !shouldReplacePlaceholderWithBufferedOutput({
            data: displayData,
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
        if (!containsDestructiveTerminalDisplayControlSequence(displayData)) {
          outputScheduler.handleChunk(displayData)
          return
        }

        shouldReplaceAgentPlaceholderOnNextDestructiveChunk = false
        shouldReplaceAgentPlaceholderOnNextVisibleChunk = true
        deferredPlaceholderBuffer.dataChunks.push(displayData)
        if (
          !shouldReplacePlaceholderWithBufferedOutput({
            data: displayData,
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
        deferredHydratedRedrawBuffer.dataChunks.push(displayData)
        const bufferedData = getDeferredHydratedRedrawData()
        const shouldFlushForVisibleOutput = shouldReplacePlaceholderWithBufferedOutput({
          data: bufferedData,
          exitCode: null,
        })
        if (!shouldFlushForVisibleOutput) {
          maybeFlushDeferredHydratedRedrawControlOnlyChunks()
          return
        }

        flushDeferredHydratedRedraw()
        settleHydratedControlOnlyProtectionFromData(displayData)
        return
      }

      const isDestructiveControlOnlyRedraw = shouldDeferHydratedTerminalRedrawChunk(displayData)
      const isControlOnlyChunk = isControlOnlyTerminalChunk(displayData)
      if (
        (shouldProtectHydratedDestructiveRedraw && isDestructiveControlOnlyRedraw) ||
        (shouldProtectHydratedControlOnlyRedraw && isControlOnlyChunk)
      ) {
        deferredHydratedRedrawBuffer.dataChunks.push(displayData)
        maybeFlushDeferredHydratedRedrawControlOnlyChunks()
        return
      }

      outputScheduler.handleChunk(displayData)
      settleHydratedControlOnlyProtectionFromData(displayData)
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
      const shouldProtectRestoredBaseline =
        shouldDeferHydratedRedrawChunks() || rawSnapshot.trim().length > 0
      shouldProtectHydratedControlOnlyRedraw = shouldProtectRestoredBaseline
      shouldProtectHydratedDestructiveRedraw = shouldProtectRestoredBaseline
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
      const shouldDeferBufferedHydratedRedraw =
        !shouldReplacePlaceholder &&
        shouldProtectRestoredBaseline &&
        bufferedData.length > 0 &&
        isControlOnlyTerminalChunk(bufferedData)
      const bufferedOutputAlreadyMatchesPlaceholder =
        shouldReplaceBufferedPlaceholder &&
        hydrationBuffer.exitCode === null &&
        bufferedData.length > 0 &&
        resolveSuffixPrefixOverlap(rawSnapshot, bufferedData) === bufferedData.length
      const bufferedDataChunksForFinalize =
        shouldDeferBufferedReplay || shouldDeferBufferedHydratedRedraw
          ? []
          : hydrationBuffer.dataChunks
      const bufferedExitCodeForFinalize =
        shouldDeferBufferedReplay || shouldDeferBufferedHydratedRedraw
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

      if (shouldDeferBufferedHydratedRedraw) {
        deferredHydratedRedrawBuffer.dataChunks.push(...hydrationBuffer.dataChunks)
        deferredHydratedRedrawBuffer.exitCode = hydrationBuffer.exitCode
        maybeFlushDeferredHydratedRedrawControlOnlyChunks()
      }

      hydrationBuffer.dataChunks.length = 0
      hydrationBuffer.exitCode = null
    },
  }
}
