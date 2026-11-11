import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { installAgentSpawnOwner } from '../../../src/app/main/controlSurface/agentSpawnContext'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'

/** Launch-policy tests enter an admitted internal chain; public raw-route tests use invoke directly. */
export function admittedGrantInvocation(
  surface: ControlSurface,
  ctx: ControlSurfaceContext,
  request: Parameters<ControlSurface['invoke']>[1],
) {
  if (
    ctx.requestAuth?.kind !== 'session-grant' ||
    ![
      'session.launchAgent',
      'session.launchAgentInMount',
      'pty.spawn',
      'pty.spawnInMount',
    ].includes(request.id)
  ) {
    return surface.invoke(ctx, request)
  }
  const grant = ctx.requestAuth.grant
  const owner = new AgentSpawnAdmissionOwner({
    snapshot: () => ({ revision: 0, bindings: [] }),
    isCurrent: () => true,
  })
  installAgentSpawnOwner(surface, owner)
  const store = {
    readAppStateRevision: async () => 0,
    readAppState: async () => ({
      workspaces: [{ nodes: [{ id: grant.nodeId, kind: 'agent', sessionId: grant.sessionId }] }],
    }),
    nodeLineage: { readMany: async () => new Map(), readAll: async () => new Map() },
    commitCreatedNodeState: async () => ({ ok: true }),
  } as unknown as NodeControlAppStateStore
  const target = {
    endpoint: { kind: 'local', endpointId: 'local' },
    workspace: { id: 'project' },
    workingDirectory: '/repo',
  } as ResolvedNodeCreationTarget
  return owner.runCreation(
    store,
    {
      authority: grant,
      nodeId: 'admitted-child',
      kind: request.id.startsWith('pty.') ? 'terminal' : 'agent',
      target,
      assertActive: () => ctx.assertActive?.(),
    },
    permit =>
      surface.invoke(
        {
          ...ctx,
          agentSpawnPermit: permit,
          spawnIdentity: {
            projectId: grant.projectId,
            spaceId: grant.spaceId,
            nodeId: 'admitted-child',
          },
        },
        request,
      ),
  )
}
