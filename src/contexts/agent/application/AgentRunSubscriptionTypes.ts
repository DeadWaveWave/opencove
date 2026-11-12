import type {
  AgentRunEvent as AgentRuntimeEvent,
  AgentRunSnapshot,
} from '../../../shared/contracts/dto/agentRunState'
export interface AgentRuntimeFilter {
  types?: AgentRuntimeEvent['type'][]
  nodeId?: string
  spaceId?: string
  projectId?: string
  state?: AgentRunSnapshot['state']
}
export interface AgentRuntimeResync {
  type: 'resync_required'
  epoch: string
  seq: number
  query: 'agent.list'
}
