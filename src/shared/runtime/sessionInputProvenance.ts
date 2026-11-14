import type { TerminalWriteEncoding } from '../contracts/dto'

/** Same-process attribution for an owned write; never sent to the PTY or over IPC. */
export interface SessionInputProvenance {
  providerSessionId: string
  invocationId: string
  conversationGeneration?: number
}
export type SessionRuntimeWrite<Result = void> = (
  sessionId: string,
  data: string,
  encoding?: TerminalWriteEncoding,
  provenance?: SessionInputProvenance,
) => Result

export type SessionInteraction = (
  sessionId: string,
  data?: string,
  provenance?: SessionInputProvenance,
) => void
