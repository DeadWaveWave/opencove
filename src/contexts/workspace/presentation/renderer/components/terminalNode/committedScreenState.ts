import type { SerializeAddon } from '@xterm/addon-serialize'
import type { Terminal } from '@xterm/xterm'

export interface CommittedTerminalScreenState {
  sessionId: string
  serialized: string
  rawSnapshot: string
  cols: number
  rows: number
}

export function captureCommittedTerminalScreenState({
  serializeAddon,
  sessionId,
  rawSnapshot,
  terminal,
}: {
  serializeAddon: SerializeAddon
  sessionId: string
  rawSnapshot: string
  terminal: Terminal
}): CommittedTerminalScreenState | null {
  const serializedScreen = serializeAddon.serialize({ excludeModes: true })
  if (serializedScreen.length === 0) {
    return null
  }

  return {
    sessionId,
    serialized: serializedScreen,
    rawSnapshot,
    cols: terminal.cols,
    rows: terminal.rows,
  }
}

export function writeTerminalChunkAndCapture({
  terminal,
  data,
  committedScrollbackBuffer,
  onCommittedScreenState,
}: {
  terminal: Terminal
  data: string
  committedScrollbackBuffer: {
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
}): void {
  terminal.write(data, () => {
    committedScrollbackBuffer.append(data)
    onCommittedScreenState(committedScrollbackBuffer.snapshot())
  })
}

export function resolveCommittedScreenStateForCache({
  latestCommittedScreenState,
  serializeAddon,
  sessionId,
  rawSnapshot,
  terminal,
}: {
  latestCommittedScreenState: CommittedTerminalScreenState | null
  serializeAddon: SerializeAddon
  sessionId: string
  rawSnapshot: string
  terminal: Terminal
}): CommittedTerminalScreenState | null {
  return (
    latestCommittedScreenState ??
    captureCommittedTerminalScreenState({
      serializeAddon,
      sessionId,
      rawSnapshot,
      terminal,
    })
  )
}

export function createCommittedScreenStateRecorder({
  serializeAddon,
  sessionId,
  terminal,
}: {
  serializeAddon: SerializeAddon
  sessionId: string
  terminal: Terminal
}): {
  record: (rawSnapshot: string) => void
  resolve: (
    rawSnapshot: string,
    options?: { allowSerializeFallback?: boolean },
  ) => CommittedTerminalScreenState | null
} {
  let latestCommittedScreenState: CommittedTerminalScreenState | null = null

  return {
    record: rawSnapshot => {
      latestCommittedScreenState =
        captureCommittedTerminalScreenState({
          serializeAddon,
          sessionId,
          rawSnapshot,
          terminal,
        }) ?? latestCommittedScreenState
    },
    resolve: (rawSnapshot, options) => {
      const allowSerializeFallback = options?.allowSerializeFallback !== false
      if (latestCommittedScreenState || allowSerializeFallback) {
        latestCommittedScreenState = resolveCommittedScreenStateForCache({
          latestCommittedScreenState,
          serializeAddon,
          sessionId,
          rawSnapshot,
          terminal,
        })
      }

      return latestCommittedScreenState
    },
  }
}
