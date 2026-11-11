import type {
  AgentSpawnAdmissionOwner,
  AgentSpawnPermit,
} from '../../../contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { ControlSurface } from './controlSurface'
import type { ControlSurfaceContext } from './types'
import { canvasSpawnOperations } from './sessionSpawnIdentityContext'
import { createAppError } from '../../../shared/errors/appError'
import { spawnForbiddenDetails } from '../../../shared/errors/agentSpawnError'
const owners = new WeakMap<ControlSurface, AgentSpawnAdmissionOwner>()
export function installAgentSpawnOwner(surface: ControlSurface, owner: AgentSpawnAdmissionOwner) {
  owners.set(surface, owner)
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
