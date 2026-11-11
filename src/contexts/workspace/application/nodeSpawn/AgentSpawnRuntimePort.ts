export interface NodeRuntimeBinding {
  nodeId: string
  sessionId: string
  runtimeOwner: 'local' | 'remote'
  state: 'running' | 'unknown'
}
export interface AgentSpawnRuntimePort {
  isSessionActive?(sessionId: string): boolean
  snapshot(): {
    revision: number
    bindings: readonly NodeRuntimeBinding[]
    /** Forwarded runtime attempts remain ambiguous until remote completion can be proven. */
    knownRemoteNodeIds?: readonly string[]
    /** Local provenance is not occupancy; active bindings still own all live slots. */
    knownLocalNodeIds?: readonly string[]
    /** Exact runtime completion facts, independent of public hub registration. */
    completedSessionIds?: readonly string[]
  }
  isCurrent(revision: number): boolean
}
