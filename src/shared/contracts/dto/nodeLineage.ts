/** Optional on the wire so older Workers remain distinguishable from known roots. */
export interface NodeLineageProjection {
  spawnedBy?: string | null
  lineageDepth?: number | null
  lineageStatus?: 'recorded' | 'root' | 'unavailable'
}
export interface ResolveCallerSelectorInput {
  selector: '@parent'
  expectedCallerNodeId?: string
}
export interface ResolveCallerSelectorResult {
  kind: 'node'
  id: string
  callerNodeId: string
}
