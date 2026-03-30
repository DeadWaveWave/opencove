import type { Terminal } from '@xterm/xterm'
import { resolveSuffixPrefixOverlap } from './overlap'
import { writeTerminalChunkAndCapture } from './committedScreenState'

export function replayBufferedHydrationOutput({
  terminal,
  rawSnapshot,
  bufferedData,
  bufferedExitCode,
  scrollbackBuffer,
  committedScrollbackBuffer,
  onCommittedScreenState,
}: {
  terminal: Terminal
  rawSnapshot: string
  bufferedData: string
  bufferedExitCode: number | null
  scrollbackBuffer: {
    append: (data: string) => void
  }
  committedScrollbackBuffer: {
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
}): void {
  if (bufferedData.length > 0) {
    const overlap = resolveSuffixPrefixOverlap(rawSnapshot, bufferedData)
    const remainder = bufferedData.slice(overlap)

    if (remainder.length > 0) {
      writeTerminalChunkAndCapture({
        terminal,
        data: remainder,
        committedScrollbackBuffer,
        onCommittedScreenState,
      })
      scrollbackBuffer.append(remainder)
    }
  }

  if (bufferedExitCode !== null) {
    const exitMessage = `\r\n[process exited with code ${bufferedExitCode}]\r\n`
    writeTerminalChunkAndCapture({
      terminal,
      data: exitMessage,
      committedScrollbackBuffer,
      onCommittedScreenState,
    })
    scrollbackBuffer.append(exitMessage)
  }
}
