import type { AgentProviderId, TerminalSessionStateSource } from '../dto'
export type AgentRunState = 'working' | 'waiting' | 'idle' | 'exited' | 'unknown'
export type TurnOutcome = 'completed' | 'failed' | 'aborted' | 'unknown'
export type AgentBlockedSummary =
  | { kind: 'question'; questions: readonly { question: string; options: readonly string[] }[] }
  | { kind: 'plan' }

export interface AgentRunSnapshot {
  sessionId: string
  nodeId: string | null
  provider: AgentProviderId
  state: AgentRunState
  blockedReason: 'permission' | 'question' | 'plan' | null
  /** Bounded, untrusted dialog data; absent on older Workers. Never persisted. */
  blockedSummary?: AgentBlockedSummary | null
  turn: { id: string; startedAt: number; start: 'observed' | 'inferred' } | null
  lastTransitionAt: number
  source: TerminalSessionStateSource | 'exit' | null
  quality: 'authoritative' | 'inferred' | 'degraded'
  turnOutcome: TurnOutcome | null
  /** Most recent reducer-ended turn in this incarnation; preserved across subsequent starts. */
  lastEndedTurn: { id: string; outcome: TurnOutcome; endedAt: number } | null
}

/** Executing Worker decision, transported separately from PTY replay sequence. */
export interface AgentRunEvent {
  type: 'agent.state_changed' | 'agent.turn_completed'
  epoch: string
  seq: number
  snapshot: AgentRunSnapshot
  endedTurn?: NonNullable<AgentRunSnapshot['turn']>
}
export type RemoteAgentRunUpdate =
  | { type: 'unavailable' }
  | { type: 'snapshot'; snapshot: AgentRunSnapshot }
  | { type: 'event'; event: AgentRunEvent }
