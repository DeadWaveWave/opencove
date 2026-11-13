import type { NodeLineageRecord } from './nodeLineage'
import { createAppError } from '../../../shared/errors/appError'
import {
  agentSpawnErrorPresentation,
  type SpawnLimitDetails,
  type SpawnQuotaNode,
} from '../../../shared/errors/agentSpawnError'
export const MAX_GRANT_RUNTIME_LINEAGE_DEPTH = 3
export const MAX_LIVE_GRANT_RUNTIME_DESCENDANTS = 6

export function assertGrantRuntimeSpawnAllowed(input: {
  lineage: NodeLineageRecord
  nodes?: SpawnQuotaNode[]
  occupied: number
  kind: 'agent' | 'terminal'
}): void {
  const depth = input.lineage.lineageDepth > MAX_GRANT_RUNTIME_LINEAGE_DEPTH
  if (!depth && input.occupied < MAX_LIVE_GRANT_RUNTIME_DESCENDANTS) {
    return
  }
  const code = depth ? 'agent.spawn_depth_limit' : 'agent.spawn_concurrency_limit'
  const details: SpawnLimitDetails = {
    reason: depth ? 'depth_limit' : 'concurrency_limit',
    retryable: false,
    nodes: input.nodes?.slice(0, 6) ?? [],
    rootNodeId: input.lineage.rootNodeId,
    callerNodeId: input.lineage.spawnedBy,
    requestedKind: input.kind,
    limit: depth ? MAX_GRANT_RUNTIME_LINEAGE_DEPTH : MAX_LIVE_GRANT_RUNTIME_DESCENDANTS,
    ...(depth ? { attemptedDepth: input.lineage.lineageDepth } : { occupied: input.occupied }),
  }
  const text = agentSpawnErrorPresentation({ code, details })!
  throw createAppError(code, { details, debugMessage: `${text.message} ${text.hint}` })
}
