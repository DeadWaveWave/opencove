import type { NodeLineageProjection } from '../../../shared/contracts/dto/nodeLineage'
import { createAppError } from '../../../shared/errors/appError'

/** Immutable creation provenance. Snapshot membership never owns these facts. */
export interface NodeLineageRecord {
  nodeId: string
  spawnedBy: string
  rootNodeId: string
  lineageDepth: number
}
export function deriveNodeLineage(input: {
  nodeId: string
  callerNodeId: string
  parent: NodeLineageRecord | null
}): NodeLineageRecord {
  const { nodeId, callerNodeId, parent } = input
  if (
    !nodeId ||
    !callerNodeId ||
    nodeId === callerNodeId ||
    (parent &&
      (parent.nodeId !== callerNodeId ||
        parent.rootNodeId === nodeId ||
        parent.spawnedBy === nodeId ||
        !Number.isSafeInteger(parent.lineageDepth) ||
        parent.lineageDepth < 2 ||
        parent.lineageDepth >= Number.MAX_SAFE_INTEGER))
  ) {
    throw createAppError('persistence.invalid_state')
  }
  return {
    nodeId,
    spawnedBy: callerNodeId,
    rootNodeId: parent?.rootNodeId ?? callerNodeId,
    lineageDepth: (parent?.lineageDepth ?? 1) + 1,
  }
}
export function projectNodeLineage(
  record: NodeLineageRecord | null,
): Required<NodeLineageProjection> {
  return record
    ? { spawnedBy: record.spawnedBy, lineageDepth: record.lineageDepth, lineageStatus: 'recorded' }
    : { spawnedBy: null, lineageDepth: 1, lineageStatus: 'root' }
}
