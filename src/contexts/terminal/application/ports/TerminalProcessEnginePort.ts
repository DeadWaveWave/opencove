import type {
  TerminalForegroundEvent,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'

export interface TerminalProcessSpawnInput {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export type TerminalProcessResizeResult =
  | { sessionId: string; status: 'applied_verified'; cols: number; rows: number }
  | { sessionId: string; status: 'applied_unverified' }

export interface TerminalProcessEnginePort {
  spawn: (input: TerminalProcessSpawnInput) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string, encoding?: TerminalWriteEncoding) => void
  probeForeground: (sessionId: string) => void
  resize: (sessionId: string, cols: number, rows: number) => Promise<TerminalProcessResizeResult>
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onForeground: (listener: (event: TerminalForegroundEvent) => void) => () => void
  crashForDebug?: () => void
  dispose: () => void
}
