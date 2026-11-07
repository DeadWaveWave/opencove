import type { CanvasNodeDetailDto, ListSessionsResult } from '../../../shared/contracts/dto'

export interface PluginSessionState {
  node: CanvasNodeDetailDto
  session: ListSessionsResult['sessions'][number] | null
  agentState: import('../../../shared/contracts/dto/agentRunState').AgentRunSnapshot | null
}
export type PluginObservationType = 'project' | 'space' | 'node' | 'session' | 'preferences'
export interface PluginObservationChange {
  type: PluginObservationType
  id: string
  change: 'created' | 'changed' | 'removed'
}
export interface PluginObservationBatch {
  subscriptionId: string
  sequence: number
  changes: PluginObservationChange[]
  truncated: boolean
}
