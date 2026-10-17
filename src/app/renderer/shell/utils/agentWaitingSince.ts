import type { AgentRuntimeStatus } from '@contexts/agent/domain/types'

export type ObservedAgentStatus = AgentRuntimeStatus | null

export interface AgentWaitingObservation {
  status: ObservedAgentStatus
  /** When this renderer saw the agent start waiting; null when that moment was not observed. */
  waitingSinceMs: number | null
}

export type AgentWaitingSinceState = ReadonlyMap<string, AgentWaitingObservation>

/**
 * Transient renderer state: a wait is stamped only when the agent was seen doing something else
 * first, so agents restored or first seen while waiting never get an invented duration.
 */
export function advanceWaitingSince(
  previous: AgentWaitingSinceState,
  agents: ReadonlyArray<{ nodeId: string; status: ObservedAgentStatus }>,
  nowMs: number,
): AgentWaitingSinceState {
  const next = new Map<string, AgentWaitingObservation>()
  let changed = previous.size !== agents.length

  for (const { nodeId, status } of agents) {
    const before = previous.get(nodeId)
    let observation: AgentWaitingObservation
    if (status !== 'waiting') {
      observation = { status, waitingSinceMs: null }
    } else if (before?.status === 'waiting') {
      observation = before
    } else {
      const sawStartWaiting = before !== undefined && before.status !== 'restoring'
      observation = { status, waitingSinceMs: sawStartWaiting ? nowMs : null }
    }

    if (
      !before ||
      before.status !== observation.status ||
      before.waitingSinceMs !== observation.waitingSinceMs
    ) {
      changed = true
    }
    next.set(nodeId, observation)
  }

  return changed ? next : previous
}
