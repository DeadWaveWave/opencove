import type { Terminal } from '@xterm/xterm'
import { resolveSuffixPrefixOverlap } from './overlap'
import { writeTerminalChunkAndCapture } from './committedScreenState'

const TERMINAL_FULL_RESET = '\u001bc'

export function replayBufferedHydrationOutput({
  terminal,
  rawSnapshot,
  bufferedData,
  bufferedExitCode,
  resetTerminalBeforeFirstWrite = false,
  scrollbackBuffer,
  committedScrollbackBuffer,
  onCommittedScreenState,
  onReplayWriteCommitted,
}: {
  terminal: Terminal
  rawSnapshot: string
  bufferedData: string
  bufferedExitCode: number | null
  resetTerminalBeforeFirstWrite?: boolean
  scrollbackBuffer: {
    append: (data: string) => void
  }
  committedScrollbackBuffer: {
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
  onReplayWriteCommitted?: () => void
}): void {
  let shouldPrefixReset = resetTerminalBeforeFirstWrite
  const writeChunk = (data: string): void => {
    const terminalData = shouldPrefixReset ? `${TERMINAL_FULL_RESET}${data}` : data
    shouldPrefixReset = false
    writeTerminalChunkAndCapture({
      terminal,
      data,
      terminalData,
      committedScrollbackBuffer,
      onCommittedScreenState,
      onWriteCommitted: onReplayWriteCommitted,
    })
  }

  if (bufferedData.length > 0) {
    const overlap = resolveSuffixPrefixOverlap(rawSnapshot, bufferedData)
    const remainder = bufferedData.slice(overlap)

    if (remainder.length > 0) {
      writeChunk(remainder)
      scrollbackBuffer.append(remainder)
    }
  }

  if (bufferedExitCode !== null) {
    const exitMessage = `\r\n[process exited with code ${bufferedExitCode}]\r\n`
    writeChunk(exitMessage)
    scrollbackBuffer.append(exitMessage)
  }
}
