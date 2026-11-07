import type { AgentProviderId, TerminalSessionStateSource } from '../dto'
export type AgentRunState = 'working' | 'waiting' | 'idle' | 'exited' | 'unknown'
export type TurnOutcome = 'completed' | 'failed' | 'aborted' | 'unknown'
export interface AgentRunSnapshot {
  sessionId: string
  nodeId: string | null
  provider: AgentProviderId
  state: AgentRunState
  blockedReason: 'permission' | 'question' | 'plan' | null
  turn: { id: string; startedAt: number; start: 'observed' | 'inferred' } | null
  lastTransitionAt: number
  source: TerminalSessionStateSource | 'exit' | null
  quality: 'authoritative' | 'inferred' | 'degraded'
  turnOutcome: TurnOutcome | null
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
