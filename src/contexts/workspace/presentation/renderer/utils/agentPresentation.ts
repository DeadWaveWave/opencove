import type { AgentRuntimeObservation, AgentRuntimeStatus, TerminalNodeData } from '../types'
import { canObserveAgentRunState } from './agentRuntimeObservation'

/** One projection for Agent chrome, action availability and sidebar status. */
export function resolveAgentPresentation(data: TerminalNodeData): {
  isAgent: boolean
  status: AgentRuntimeStatus | null
  observation: AgentRuntimeObservation | null
} {
  const isAgent = data.kind === 'agent' || canObserveAgentRunState(data)
  if (!isAgent) {
    return { isAgent, status: null, observation: null }
  }

  // Historical terminal bindings are not live presentation. Dedicated Agent windows
  // still show their PTY terminal state ahead of any stale hook/file observation.
  if (!canObserveAgentRunState(data)) {
    return {
      isAgent,
      status: data.status,
      observation: null,
    }
  }

  const observation = data.agentRuntimeObservation ?? null
  return {
    isAgent,
    status: observation?.status ?? data.agentOverlay?.status ?? data.status,
    observation,
  }
}
