import type {
  CanvasNodeDetailDto,
  ListSessionsResult,
  TerminalSessionStateEvent,
} from '../../../shared/contracts/dto'

export interface PluginSessionState {
  node: CanvasNodeDetailDto
  session: ListSessionsResult['sessions'][number] | null
  agentState: TerminalSessionStateEvent | null
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
