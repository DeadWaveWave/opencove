/** Optional on the wire so older Workers remain distinguishable from known roots. */
export interface NodeLineageProjection {
  /** Verified creator node ID; null for roots or unavailable lineage. */
  spawnedBy?: string | null
  /** User-started roots have depth 1; each agent-created generation adds one. Null if unavailable. */
  lineageDepth?: number | null
  /** Recorded creation, a root without recorded ancestry, or unreadable lineage. */
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

/** Optional identity projection; counts agent-created runtimes, excluding the user root. */
export interface LineageQuota {
  depth: number
  maxDepth: number
  liveInTree: number
  maxLiveInTree: number
  /** Absent on older Workers. */
  remainingLiveInTree?: number
}
