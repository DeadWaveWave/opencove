import type { AgentRuntimeObservation, AgentRuntimeStatus, TerminalNodeData } from '../types'
import { canObserveAgentRunState } from './agentRuntimeObservation'
import { isAgentTreatedNode } from './terminalAgentOverlay'

/** One projection for Agent chrome, action availability and sidebar status. */
export function resolveAgentPresentation(data: TerminalNodeData): {
  isAgent: boolean
  status: AgentRuntimeStatus | null
  observation: AgentRuntimeObservation | null
} {
  const isAgent = isAgentTreatedNode({ data })
  if (!isAgent) {
    return { isAgent, status: null, observation: null }
  }

  // A resumable conversation is not proof of a live invocation. Likewise a dedicated
  // Agent's PTY terminal state must dominate its last hook/file observation.
  if (!canObserveAgentRunState(data)) {
    return {
      isAgent,
      status: data.kind === 'agent' ? data.status : 'standby',
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
