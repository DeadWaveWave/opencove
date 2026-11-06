import { randomUUID } from 'node:crypto'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import { createAppError } from '../../../shared/errors/appError'
import type { ControlSurfaceContext } from './types'
import type { CanvasSpawnIdentity } from './sessionSpawnIdentityContext'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function resolveCanvasSpawnIdentity(
  ctx: ControlSurfaceContext,
  payload: unknown,
  getStore: () => Promise<PersistenceStore>,
): Promise<CanvasSpawnIdentity | undefined> {
  if (ctx.spawnIdentity) {
    return ctx.spawnIdentity
  }
  const input = record(payload)
  if (input.workerSpawnIdentity !== undefined) {
    if (ctx.requestAuth?.kind !== 'bearer') {
      throw createAppError('common.forbidden')
    }
    const identity = record(input.workerSpawnIdentity)
    if (
      !['projectId', 'nodeId'].every(
        key => typeof identity[key] === 'string' && identity[key].length > 0,
      ) ||
      typeof identity.spaceId !== 'string'
    ) {
      throw createAppError('common.invalid_input')
    }
    return {
      projectId: identity.projectId as string,
      spaceId: identity.spaceId as string,
      nodeId: identity.nodeId as string,
    }
  }
  if (
    input.canvasNodeId !== undefined &&
    (typeof input.canvasNodeId !== 'string' ||
      !input.canvasNodeId.trim() ||
      input.canvasNodeId.length > 256)
  ) {
    throw createAppError('common.invalid_input')
  }
  const nodeId = typeof input.canvasNodeId === 'string' ? input.canvasNodeId : undefined
  if (nodeId && ctx.requestAuth?.kind === 'session-grant') {
    throw createAppError('common.forbidden')
  }
  if (!nodeId && !input.workspaceId && !input.spaceId) {
    return undefined
  }
  const state = normalizePersistedAppState(await (await getStore()).readAppState())
  const workspaces = state?.workspaces ?? []
  const existing = nodeId
    ? workspaces.find(workspace => workspace.nodes.some(node => node.id === nodeId))
    : undefined
  if (existing) {
    const space = existing.spaces.find(candidate => candidate.nodeIds.includes(nodeId!))
    if (
      (input.workspaceId && input.workspaceId !== existing.id) ||
      (input.spaceId && input.spaceId !== space?.id)
    ) {
      throw createAppError('common.invalid_input')
    }
    return { projectId: existing.id, spaceId: space?.id ?? '', nodeId: nodeId! }
  }
  const workspace = workspaces.find(candidate =>
    input.workspaceId
      ? candidate.id === input.workspaceId
      : input.spaceId
        ? candidate.spaces.some(space => space.id === input.spaceId)
        : false,
  )
  if (!workspace) {
    if (nodeId || input.spaceId) {
      throw createAppError('common.invalid_input')
    }
    // Legacy non-canvas PTY calls carry no canvas identity.
    return undefined
  }
  const space =
    typeof input.spaceId === 'string' && input.spaceId
      ? workspace.spaces.find(candidate => candidate.id === input.spaceId)
      : undefined
  if (input.spaceId && !space) {
    throw createAppError('common.invalid_input')
  }
  return { projectId: workspace.id, spaceId: space?.id ?? '', nodeId: nodeId ?? randomUUID() }
}
