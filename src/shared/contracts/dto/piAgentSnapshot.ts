import type { TerminalSessionState } from './terminal'

/** Launch-scoped, complete Pi observation; never a replay of isolated lifecycle events. */
export interface PiAgentSnapshot {
  version: 1
  pid: number
  sequence: number
  conversationRevision: number
  sessionId: string
  sessionFile: string | null
  persistence: 'allocated' | 'resumable' | 'ephemeral'
  state: TerminalSessionState
}
