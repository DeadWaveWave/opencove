import type {
  AgentSpawnAdmissionOwner,
  AgentSpawnPermit,
} from '../../../contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { ControlSurface } from './controlSurface'
import type { ControlSurfaceContext } from './types'
import { canvasSpawnOperations } from './sessionSpawnIdentityContext'
import { createAppError } from '../../../shared/errors/appError'
import { spawnForbiddenDetails } from '../../../shared/errors/agentSpawnError'
import type { LineageQuota } from '../../../shared/contracts/dto/nodeLineage'
import type { NodeControlAppStateStore } from '../../../contexts/workspace/application/nodeControl/nodeControlState'
const quotaReaders = new WeakMap<ControlSurface, (nodeId: string) => Promise<LineageQuota>>()
export async function readCallerLineageQuota(surface: ControlSurface, nodeId: string) {
  try {
    return await quotaReaders.get(surface)?.(nodeId)
  } catch {
    // Identity remains usable when the admission census cannot prove a quota. Never invent usage.
    return undefined
  }
}
const owners = new WeakMap<ControlSurface, AgentSpawnAdmissionOwner>()
export function installAgentSpawnOwner(
  surface: ControlSurface,
  owner: AgentSpawnAdmissionOwner,
  store?: () => Promise<NodeControlAppStateStore>,
) {
  owners.set(surface, owner)
  if (store) {
    quotaReaders.set(surface, async nodeId => owner.lineageQuota(await store(), nodeId))
  }
}
export function assertGrantSpawnRoute(
  surface: ControlSurface,
  ctx: ControlSurfaceContext,
  id: string,
): void {
  if (ctx.requestAuth?.kind !== 'session-grant' || !canvasSpawnOperations.has(id)) {
    return
  }
  const owner = owners.get(surface)
  if (!owner) {
    throw createAppError('common.forbidden', {
      details: spawnForbiddenDetails('node_create_required', id),
    })
  }
  owner.authorize(ctx.agentSpawnPermit, ctx.requestAuth.grant, id, ctx.spawnIdentity?.nodeId)
}
export type { AgentSpawnPermit }
