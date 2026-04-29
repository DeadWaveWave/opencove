import type { Terminal } from '@xterm/xterm'
import { finalizeTerminalHydration } from './finalizeHydration'
import {
  extractAutomaticTerminalQuerySequences,
  isAutomaticTerminalQuery,
} from './inputClassification'
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
  handleDataChunk: (data: string, options?: { seq?: number | null }) => void
  handleExit: (exitCode: number) => void
  protectHydratedVisibleBaseline: () => void
  finalizeHydration: (rawSnapshot: string, options?: { baselineAppliedSeq?: number | null }) => void
}

interface BufferedHydrationChunk {
  data: string
  seq: number | null
  deliveredDuringHydration: boolean
}

function normalizeTerminalDataSeq(seq: number | null | undefined): number | null {
  if (typeof seq !== 'number' || !Number.isFinite(seq)) {
    return null
  }

  return Math.max(0, Math.floor(seq))
}

export function createTerminalHydrationRouter({
  terminal,
  outputScheduler,
  shouldReplaceAgentPlaceholderAfterHydration,
  shouldReplaceAuthoritativeBaselineWithBufferedOutput = () => false,
  shouldDeferHydratedRedrawChunks,
  scrollbackBuffer,
  committedScrollbackBuffer,
  recordCommittedScreenState,
  scheduleTranscriptSync,
  ptyWriteQueue,
  markScrollbackDirty,
  logHydrated,
  syncTerminalSize,
  onReplayWriteCommitted,
  onRevealed,
  isDisposed,
}: {
  terminal: Terminal
  outputScheduler: {
    handleChunk: (data: string, options?: { immediateScrollbackPublish?: boolean }) => void
  }
  shouldReplaceAgentPlaceholderAfterHydration: () => boolean
  shouldReplaceAuthoritativeBaselineWithBufferedOutput?: () => boolean
  shouldDeferHydratedRedrawChunks: () => boolean
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
  onReplayWriteCommitted?: () => void
  onRevealed: () => void
  isDisposed: () => boolean
}): TerminalHydrationRouter {
  let isHydrating = true
  const hydrationBuffer = {
    dataChunks: [] as BufferedHydrationChunk[],
    exitCode: null as number | null,
  }
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
      onReplayWriteCommitted: () => {
        scheduleTranscriptSync()
        onReplayWriteCommitted?.()
      },
    })
    markScrollbackDirty(true)
    scheduleTranscriptSync()
  }

  const maybeFlushDeferredHydratedRedrawControlOnlyChunks = (): void => {
    const bufferedData = getDeferredHydratedRedrawData()
    if (endsWithIncompleteTerminalControlSequence(bufferedData)) {
      return
    }

    scheduleDeferredHydratedRedrawFlush()
  }

  const settleHydratedRedrawProtectionFromData = (data: string): void => {
    if (!shouldProtectHydratedControlOnlyRedraw && !shouldProtectHydratedDestructiveRedraw) {
      return
    }

    if (!containsMeaningfulTerminalDisplayContent(data)) {
      return
    }

    shouldProtectHydratedControlOnlyRedraw = false
  }

  const protectHydratedVisibleBaseline = (): void => {
    shouldProtectHydratedControlOnlyRedraw = true
    shouldProtectHydratedDestructiveRedraw = true
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
      flushDeferredHydratedRedraw()
    }, 2_000)
  }

  return {
    protectHydratedVisibleBaseline,
    handleDataChunk: (data, options) => {
      const displayData = stripEchoedTerminalControlSequences(data)
      if (data.length > 0 && displayData.length === 0) {
        return
      }

      if (isHydrating) {
        const shouldDeliverQueryImmediately = isAutomaticTerminalQuery(displayData)
        if (shouldDeliverQueryImmediately) {
          outputScheduler.handleChunk(displayData)
        }

        hydrationBuffer.dataChunks.push({
          data: displayData,
          seq: normalizeTerminalDataSeq(options?.seq),
          deliveredDuringHydration: shouldDeliverQueryImmediately,
        })
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
        settleHydratedRedrawProtectionFromData(displayData)
        return
      }

      const isDestructiveControlOnlyRedraw = shouldDeferHydratedTerminalRedrawChunk(displayData)
      const isControlOnlyChunk = isControlOnlyTerminalChunk(displayData)
      const isIncompleteControlChunk = endsWithIncompleteTerminalControlSequence(displayData)
      const shouldProtectDestructiveRedraw =
        shouldProtectHydratedDestructiveRedraw && isDestructiveControlOnlyRedraw
      const shouldProtectControlOnlyRedraw =
        shouldProtectHydratedControlOnlyRedraw && isControlOnlyChunk
      if (
        isIncompleteControlChunk ||
        shouldProtectDestructiveRedraw ||
        shouldProtectControlOnlyRedraw
      ) {
        deferredHydratedRedrawBuffer.dataChunks.push(displayData)
        maybeFlushDeferredHydratedRedrawControlOnlyChunks()
        return
      }

      outputScheduler.handleChunk(displayData)
      settleHydratedRedrawProtectionFromData(displayData)
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
    finalizeHydration: (rawSnapshot, options) => {
      isHydrating = false
      const baselineAppliedSeq = normalizeTerminalDataSeq(options?.baselineAppliedSeq)
      const bufferedHydrationChunks = hydrationBuffer.dataChunks.flatMap(chunk => {
        if (chunk.deliveredDuringHydration) {
          return []
        }

        if (baselineAppliedSeq === null) {
          return [chunk.data]
        }

        if (chunk.seq === null) {
          const automaticQueries = extractAutomaticTerminalQuerySequences(chunk.data)
          return automaticQueries.length > 0 ? [automaticQueries.join('')] : []
        }

        if (chunk.seq > baselineAppliedSeq) {
          return [chunk.data]
        }

        if (isAutomaticTerminalQuery(chunk.data)) {
          return [chunk.data]
        }

        const automaticQueries = extractAutomaticTerminalQuerySequences(chunk.data)
        return automaticQueries.length > 0 ? [automaticQueries.join('')] : []
      })
      const shouldProtectRestoredBaseline =
        shouldDeferHydratedRedrawChunks() || rawSnapshot.trim().length > 0
      shouldProtectHydratedControlOnlyRedraw = shouldProtectRestoredBaseline
      shouldProtectHydratedDestructiveRedraw = shouldProtectRestoredBaseline
      const bufferedData = bufferedHydrationChunks.join('')
      const bufferedDataContainsVisibleBaseline =
        containsMeaningfulTerminalDisplayContent(bufferedData)
      const shouldReplacePlaceholder = shouldReplaceAgentPlaceholderAfterHydration()
      const shouldReplaceAuthoritativeBaseline =
        !shouldReplacePlaceholder &&
        shouldReplaceAuthoritativeBaselineWithBufferedOutput() &&
        rawSnapshot.trim().length > 0 &&
        bufferedData.length > 0 &&
        containsDestructiveTerminalDisplayControlSequence(bufferedData) &&
        containsMeaningfulTerminalDisplayContent(bufferedData)
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
        !isAutomaticTerminalQuery(bufferedData) &&
        isControlOnlyTerminalChunk(bufferedData)
      const bufferedOutputAlreadyMatchesPlaceholder =
        shouldReplaceBufferedPlaceholder &&
        hydrationBuffer.exitCode === null &&
        bufferedData.length > 0 &&
        resolveSuffixPrefixOverlap(rawSnapshot, bufferedData) === bufferedData.length
      const bufferedDataChunksForFinalize =
        shouldDeferBufferedReplay || shouldDeferBufferedHydratedRedraw
          ? []
          : bufferedHydrationChunks
      const bufferedExitCodeForFinalize =
        shouldDeferBufferedReplay || shouldDeferBufferedHydratedRedraw
          ? null
          : hydrationBuffer.exitCode

      const didReplaceBaseline = finalizeTerminalHydration({
        isDisposed,
        rawSnapshot,
        replaceHydrationSnapshotWithBufferedOutput:
          shouldReplaceBufferedPlaceholder || shouldReplaceAuthoritativeBaseline,
        scrollbackBuffer,
        ptyWriteQueue,
        bufferedDataChunks: [...bufferedDataChunksForFinalize],
        bufferedExitCode: bufferedExitCodeForFinalize,
        terminal,
        committedScrollbackBuffer,
        onCommittedScreenState: recordCommittedScreenState,
        markScrollbackDirty,
        logHydrated,
        syncTerminalSize,
        onReplayWriteCommitted,
        onRevealed,
      })

      if (shouldProtectRestoredBaseline || bufferedDataContainsVisibleBaseline) {
        protectHydratedVisibleBaseline()
      }

      if (shouldReplacePlaceholder && !didReplaceBaseline) {
        if (bufferedOutputAlreadyMatchesPlaceholder) {
          shouldReplaceAgentPlaceholderOnNextDestructiveChunk = true
        } else {
          deferredPlaceholderBuffer.dataChunks.push(...bufferedHydrationChunks)
          deferredPlaceholderBuffer.exitCode = hydrationBuffer.exitCode
          shouldReplaceAgentPlaceholderOnNextVisibleChunk = true
        }
      }

      if (shouldDeferBufferedHydratedRedraw) {
        deferredHydratedRedrawBuffer.dataChunks.push(...bufferedHydrationChunks)
        deferredHydratedRedrawBuffer.exitCode = hydrationBuffer.exitCode
        maybeFlushDeferredHydratedRedrawControlOnlyChunks()
      }

      hydrationBuffer.dataChunks.length = 0
      hydrationBuffer.exitCode = null
    },
  }
}
