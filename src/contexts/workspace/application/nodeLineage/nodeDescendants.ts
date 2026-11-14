import { createAppError } from '../../../../shared/errors/appError'
import type { NodeLineageRepository } from './NodeLineageRepository'

/** Creation records survive moves and parent deletion; sharing a root is not delegation. */
export async function isSelfOrRecordedDescendant(
  repository: NodeLineageRepository | undefined,
  callerNodeId: string,
  targetNodeId: string,
): Promise<boolean> {
  const visited = new Set<string>()
  let current = targetNodeId
  while (current !== callerNodeId) {
    if (visited.has(current)) {
      throw createAppError('persistence.invalid_state')
    }
    visited.add(current)
    if (!repository) {
      throw createAppError('persistence.unavailable')
    }
    let record
    try {
      // eslint-disable-next-line no-await-in-loop -- Follow immutable parent records, not snapshot fields.
      record = (await repository.readMany([current])).get(current)
    } catch {
      throw createAppError('persistence.unavailable')
    }
    if (!record) {
      return false
    }
    if (record.nodeId !== current || !record.spawnedBy) {
      throw createAppError('persistence.invalid_state')
    }
    current = record.spawnedBy
  }
  return true
}
