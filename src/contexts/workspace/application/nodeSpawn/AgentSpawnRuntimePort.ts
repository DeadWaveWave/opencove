export interface NodeRuntimeBinding {
  nodeId: string
  sessionId: string
  runtimeOwner: 'local' | 'remote'
  state: 'running' | 'unknown'
}
export interface AgentSpawnRuntimePort {
  isSessionActive?(sessionId: string): boolean
  snapshot(): { revision: number; bindings: readonly NodeRuntimeBinding[] }
  isCurrent(revision: number): boolean
}
