import { readCallerLineageQuota } from '../agentSpawnContext'
import { managedClaudeWritesEnabled } from '../managedClaudeCompatibility'
import { registerOperationIntrospectionHandlers } from './operationIntrospectionHandlers'
import {
  systemCapabilitiesOperation,
  systemPingOperation,
  systemWhoamiOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/system'
import { registerOperation } from '../registerOperation'
import { hostname } from 'node:os'
import type { ControlSurface } from '../controlSurface'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../../shared/contracts/controlSurface'
import type {
  ControlSurfaceCapabilitiesResult,
  ControlSurfaceHomeDirectoryResult,
  ControlSurfacePingResult,
} from '../../../../shared/contracts/dto'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import { getRuntimeBuildIdentity } from '../../../../shared/runtime/runtimeBuildIdentity'
export function registerSystemHandlers(
  controlSurface: ControlSurface,
  deps: {
    appVersion: string | null
    deploymentId?: string | null
    instanceId?: string
    isReady?: () => boolean
    hasBoundedAgentSpawning?: () => Promise<boolean>
    hasEventStream?: boolean
    hasNodeLineage?: () => Promise<boolean>
  },
): void {
  registerOperationIntrospectionHandlers(controlSurface)
  registerOperation(controlSurface, systemWhoamiOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) => {
      const auth = ctx.requestAuth
      const identity =
        auth?.kind === 'session-grant'
          ? {
              kind: auth.kind,
              scopeTier: auth.grant.tier,
              projectId: auth.grant.projectId,
              spaceId: auth.grant.spaceId,
              nodeId: auth.grant.nodeId,
              sessionId: auth.grant.sessionId,
            }
          : {
              kind: auth?.kind === 'cookie' ? ('cookie' as const) : ('bearer' as const),
              scopeTier: 'admin' as const,
            }
      const lineageQuota =
        auth?.kind === 'session-grant' && auth.grant.nodeId
          ? await readCallerLineageQuota(
              controlSurface,
              auth.grant.nodeId,
              input.includeTree === true,
            )
          : undefined
      return {
        ...identity,
        ...(lineageQuota ? { lineageQuota } : {}),
        instanceId: deps.instanceId,
        appVersion: deps.appVersion,
      }
    },
  })
  registerOperation(controlSurface, systemPingOperation, {
    handle: ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
      }) satisfies ControlSurfacePingResult,
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('system.homeDirectory', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
        platform: process.platform,
        homeDirectory: resolveHomeDirectory(),
        hostname: hostname(),
      }) satisfies ControlSurfaceHomeDirectoryResult,
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, systemCapabilitiesOperation, {
    handle: async ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
        protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
        appVersion: deps.appVersion,
        runtimeBuild: getRuntimeBuildIdentity(),
        deploymentId: deps.deploymentId ?? null,
        instanceId: deps.instanceId,
        runtimeReady: deps.isReady?.() ?? false,
        features: {
          ...ctx.capabilities,
          boundedAgentSpawningV1: Boolean(
            (await deps.hasBoundedAgentSpawning?.()) && (await deps.hasNodeLineage?.()),
          ),
          operationRegistry: true,
          eventStreamV1: deps.hasEventStream === true,
          managedClaudeResumeBindingV1: true,
          managedClaudeResumeBindingDeliveryV1: true,
          managedClaudeResumeBindingWritesEnabled: managedClaudeWritesEnabled(),
          nodeLineageV1:
            controlSurface.hasOperation('node.resolveCallerSelector') &&
            ((await deps.hasNodeLineage?.()) ?? false),
        },
      }) satisfies ControlSurfaceCapabilitiesResult,
    defaultErrorCode: 'common.unexpected',
  })
}
