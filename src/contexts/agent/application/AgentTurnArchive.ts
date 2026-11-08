import type { TurnOutcome } from '../domain/agentRunState'

/** Private ended records only. Never add hook evidence, prompt text or runtime authority. */
export interface ArchivedAgentTurn {
  nodeId: string
  turnId: string
  seq: number
  sessionId: string
  provider: string
  providerSessionId: string | null
  promptId: string | null
  outcome: TurnOutcome
  endedAt: number
  archivedAt: number
  message: string | null
  messageKind?: 'intermediate'
  truncated: boolean
  superseded: boolean
  messageBytes: number
}

/** Ownership captured at end: launch/spawn node, else end-time binding; never a read-time binding. */
export type AgentTurnArchiveInput = Omit<
  ArchivedAgentTurn,
  'seq' | 'archivedAt' | 'messageBytes' | 'nodeId'
> & {
  nodeId: string | null
  remote?: boolean
}
export type AgentTurnArchiveAppendResult =
  | { status: 'persisted' }
  | {
      status: 'memory_only'
      reason:
        | 'unavailable'
        | 'unbound'
        | 'remote'
        | 'write_failed'
        | 'deleted'
        | 'retention_backlog'
    }
export type AgentTurnArchiveReadResult =
  | { status: 'found'; record: ArchivedAgentTurn }
  | { status: 'absent' }
  | { status: 'unavailable' }

export type ArchiveMembership = (nodeId?: string) => 'member' | 'absent' | 'unknown'
export type ArchiveSweepResult = { status: 'complete' | 'more' | 'unavailable' }

/** Synchronous, non-reentrant, never throws; the membership oracle is a Worker-owned projection. */
export interface AgentTurnArchive {
  append(record: AgentTurnArchiveInput): AgentTurnArchiveAppendResult
  getExact(input: { nodeId: string; turnId: string }): AgentTurnArchiveReadResult
  getExactBySession(input: { sessionId: string; turnId: string }): AgentTurnArchiveReadResult
  revokeNodes(nodeIds: readonly string[]): void
  captureWatermark(): number | null
  sweep(now: number, existingNodeIds?: ReadonlySet<string>, throughSeq?: number): ArchiveSweepResult
  checkpoint(): void
  dispose(): void
}

export const AGENT_TURN_ARCHIVE_LIMITS = {
  perNode: 50,
  records: 20_000,
  messageBytes: 128 * 1024 * 1024,
  ageMs: 30 * 24 * 60 * 60 * 1000,
  sweepBatch: 256,
  appendEvictions: 64,
  revokedNodes: 20_000,
} as const
