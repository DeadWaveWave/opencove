import type { SerializeAddon } from '@xterm/addon-serialize'
import type { Terminal } from '@xterm/xterm'

type TerminalBufferKind = 'normal' | 'alternate' | 'unknown'

export interface CommittedTerminalScreenState {
  sessionId: string
  serialized: string
  rawSnapshot: string
  cols: number
  rows: number
  bufferKind: TerminalBufferKind
}

function resolveTerminalBufferKind(terminal: Terminal): TerminalBufferKind {
  const buffer = (terminal as unknown as { buffer?: { active?: { type?: unknown } } }).buffer
  const type = buffer?.active?.type
  if (type === 'alternate') {
    return 'alternate'
  }
  if (type === 'normal') {
    return 'normal'
  }
  return 'unknown'
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
    bufferKind: resolveTerminalBufferKind(terminal),
  }
}

export function writeTerminalChunkAndCapture({
  terminal,
  data,
  terminalData = data,
  committedScrollbackBuffer,
  onCommittedScreenState,
  onWriteCommitted,
}: {
  terminal: Terminal
  data: string
  terminalData?: string
  committedScrollbackBuffer: {
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
  onWriteCommitted?: () => void
}): void {
  terminal.write(terminalData, () => {
    committedScrollbackBuffer.append(data)
    onCommittedScreenState(committedScrollbackBuffer.snapshot())
    onWriteCommitted?.()
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
      const currentBufferKind = resolveTerminalBufferKind(terminal)
      const shouldRefreshForBufferSwitch =
        allowSerializeFallback &&
        currentBufferKind !== 'unknown' &&
        latestCommittedScreenState?.bufferKind !== currentBufferKind

      if (shouldRefreshForBufferSwitch) {
        latestCommittedScreenState =
          captureCommittedTerminalScreenState({
            serializeAddon,
            sessionId,
            rawSnapshot,
            terminal,
          }) ?? latestCommittedScreenState
      } else if (latestCommittedScreenState || allowSerializeFallback) {
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
