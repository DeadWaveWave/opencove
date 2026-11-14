import type { CanvasNodeDetailDto } from './nodeControl'
export interface ClaimTaskInput {
  taskNodeId: string
  agentNodeId?: string
}
export interface ReleaseTaskInput {
  taskNodeId: string
  status?: 'todo' | 'ai_done' | 'done'
}
export interface TaskMutationResult {
  revision: number
  node: CanvasNodeDetailDto
  changed: boolean
}
export interface AppendNoteInput {
  nodeId: string
  text: string
}
export interface AppendNoteResult {
  revision: number
  nodeId: string
  appendedBytes: number
  totalBytes: number
}
