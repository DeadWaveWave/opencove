import type { NodeControlAppStateStore } from '../nodeControl/nodeControlState'
import { requireNodeControlState } from '../nodeControl/nodeControlState'
import { deriveNodeLineage, projectNodeLineage } from '../../domain/nodeLineage'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import type {
  NodeLineageProjection,
  ResolveCallerSelectorInput,
  ResolveCallerSelectorResult,
} from '../../../../shared/contracts/dto/nodeLineage'
import { createAppError } from '../../../../shared/errors/appError'

async function readLineage(
  store: Pick<NodeControlAppStateStore, 'nodeLineage'>,
  ids: readonly string[],
) {
  try {
    if (!store.nodeLineage) {
      throw createAppError('persistence.unavailable')
    }
    return await store.nodeLineage.readMany(ids)
  } catch {
    throw createAppError('persistence.unavailable')
  }
}

export async function prepareNodeLineage(
  store: NodeControlAppStateStore,
  nodeId: string,
  callerNodeId?: string | null,
): Promise<NodeLineageRecord | null> {
  if (!callerNodeId) {
    return null
  }
  if (!store.nodeLineage || !store.commitCreatedNodeState) {
    throw createAppError('persistence.unavailable')
  }
  const state = requireNodeControlState(await store.readAppState())
  if (!state.workspaces.some(w => w.nodes.some(n => n.id === callerNodeId))) {
    throw createAppError('node.not_found')
  }
  const rows = await readLineage(store, [callerNodeId])
  return deriveNodeLineage({ nodeId, callerNodeId, parent: rows.get(callerNodeId) ?? null })
}

export async function projectNodeLineages<T extends { id: string }>(
  store: Pick<NodeControlAppStateStore, 'nodeLineage'>,
  nodes: T[],
  spawnedByNodeId?: string | null,
): Promise<(T & NodeLineageProjection)[]> {
  let rows: ReadonlyMap<string, NodeLineageRecord>
  try {
    if (!store.nodeLineage) {
      throw createAppError('persistence.unavailable')
    }
    rows = await readLineage(
      store,
      nodes.map(n => n.id),
    )
  } catch (error) {
    if (spawnedByNodeId) {
      throw error
    }
    return nodes.map(node => ({
      ...node,
      spawnedBy: null,
      lineageDepth: null,
      lineageStatus: 'unavailable',
    }))
  }
  return nodes
    .filter(n => !spawnedByNodeId || rows.get(n.id)?.spawnedBy === spawnedByNodeId)
    .map(node => ({ ...node, ...projectNodeLineage(rows.get(node.id) ?? null) }))
}

export async function resolveCallerParent(
  store: NodeControlAppStateStore,
  callerNodeId: string | null,
  input: ResolveCallerSelectorInput,
): Promise<ResolveCallerSelectorResult> {
  const unavailable = (reason: string): never => {
    throw createAppError('node.parent_unavailable', { details: { reason } })
  }
  if (!callerNodeId) {
    return unavailable('caller_identity_required')
  }
  if (input.expectedCallerNodeId && input.expectedCallerNodeId !== callerNodeId) {
    throw createAppError('common.forbidden', { details: { reason: 'caller_identity_mismatch' } })
  }
  const state = requireNodeControlState(await store.readAppState())
  const exists = (id: string) => state.workspaces.some(w => w.nodes.some(n => n.id === id))
  if (!exists(callerNodeId)) {
    throw createAppError('node.not_found')
  }
  if (!store.nodeLineage) {
    throw createAppError('persistence.unavailable')
  }
  const record = (await readLineage(store, [callerNodeId])).get(callerNodeId)
  if (!record) {
    return unavailable('no_parent')
  }
  if (!exists(record.spawnedBy)) {
    return unavailable('parent_deleted')
  }
  return { kind: 'node', id: record.spawnedBy, callerNodeId }
}
