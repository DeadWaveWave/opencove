import { hostname } from 'node:os'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import {
  endpointHomeDirectoryOperation,
  endpointListOperation,
  endpointPingOperation,
  endpointPrepareOperation,
  endpointReadDirectoryOperation,
  endpointRegisterManagedSshOperation,
  endpointRegisterOperation,
  endpointRemoveOperation,
  endpointRepairOperation,
  endpointSshConfigHostsOperation,
  endpointUpdateManagedSshOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/endpoint'
import {
  mountCreateOperation,
  mountListOperation,
  mountPromoteOperation,
  mountRemoveOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/mount'
import { mountTargetResolveOperation } from '../../../../shared/contracts/controlSurface/operations/domains/mountTarget'
import type {
  ControlSurfaceHomeDirectoryResult,
  GetEndpointHomeDirectoryResult,
  ListWorkerEndpointOverviewsResult,
  PingWorkerEndpointResult,
  PrepareWorkerEndpointResult,
  ReadEndpointDirectoryResult,
  RepairWorkerEndpointResult,
  SshConfigHost,
} from '../../../../shared/contracts/dto'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { EndpointHealthService } from '../topology/endpointHealthService'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { isUnknownControlSurfaceOperationError } from './topologyHandlerPayloads'
export function registerTopologyHandlers(
  controlSurface: ControlSurface,
  deps: {
    topology: WorkerTopologyStore
    approvedWorkspaces: ApprovedWorkspaceStore
    endpointHealth: EndpointHealthService
    readSshConfigHosts: () => Promise<SshConfigHost[]>
  },
): void {
  registerOperation(controlSurface, endpointListOperation, {
    handle: async () => await deps.topology.listEndpoints(),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointSshConfigHostsOperation, {
    handle: async () => await deps.readSshConfigHosts(),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointRegisterOperation, {
    handle: async (_ctx, payload) => await deps.topology.registerEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointRegisterManagedSshOperation, {
    handle: async (_ctx, payload) => await deps.topology.registerManagedSshEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointUpdateManagedSshOperation, {
    handle: async (_ctx, payload) => {
      const result = await deps.topology.updateManagedSshEndpoint(payload)
      try {
        await deps.endpointHealth.prepareEndpoint({
          endpointId: payload.endpointId,
          reason: 'reconnect',
        })
      } catch {
        // Durable update succeeded. Runtime health remains observable and repairable separately.
      }
      return result
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointRemoveOperation, {
    handle: async (_ctx, payload) => await deps.topology.removeEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('endpoint.overview.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async (): Promise<ListWorkerEndpointOverviewsResult> =>
      await deps.endpointHealth.listOverviews(),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointPrepareOperation, {
    handle: async (_ctx, payload): Promise<PrepareWorkerEndpointResult> =>
      await deps.endpointHealth.prepareEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointRepairOperation, {
    handle: async (_ctx, payload): Promise<RepairWorkerEndpointResult> =>
      await deps.endpointHealth.repairEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointPingOperation, {
    handle: async (ctx, payload): Promise<PingWorkerEndpointResult> => {
      if (payload.endpointId === 'local') {
        return {
          ok: true,
          endpointId: 'local',
          now: ctx.now().toISOString(),
          pid: process.pid,
        }
      }

      const endpoint = await deps.topology.resolveRemoteEndpointConnection(payload.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }

      try {
        const primaryRequest = { kind: 'query' as const, id: 'system.ping', payload: null }
        const { result } = await invokeControlSurface(endpoint, primaryRequest, {
          timeoutMs: payload.timeoutMs ?? undefined,
        })

        if (!result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
          })
        }

        if (result.ok === false) {
          if (isUnknownControlSurfaceOperationError(result.error, primaryRequest.id)) {
            const fallbackRequest = { kind: 'query' as const, id: 'project.list', payload: null }
            const fallback = await invokeControlSurface(endpoint, fallbackRequest, {
              timeoutMs: payload.timeoutMs ?? undefined,
            })

            if (!fallback.result) {
              throw createAppError('worker.unavailable', {
                debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
              })
            }

            if (fallback.result.ok === false) {
              throw createAppError(fallback.result.error)
            }

            return {
              ok: true,
              endpointId: payload.endpointId,
              now: ctx.now().toISOString(),
              pid: 0,
            }
          }

          throw createAppError(result.error)
        }

        const value = result.value as { now?: unknown; pid?: unknown }
        return {
          ok: true,
          endpointId: payload.endpointId,
          now: typeof value.now === 'string' ? value.now : ctx.now().toISOString(),
          pid:
            typeof value.pid === 'number' && Number.isFinite(value.pid) ? Math.floor(value.pid) : 0,
        }
      } catch (error) {
        if (error instanceof OpenCoveAppError) {
          throw error
        }

        throw createAppError('worker.unavailable', {
          debugMessage:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointHomeDirectoryOperation, {
    handle: async (_ctx, payload): Promise<GetEndpointHomeDirectoryResult> => {
      if (payload.endpointId === 'local') {
        return {
          endpointId: 'local',
          platform: process.platform,
          homeDirectory: resolveHomeDirectory(),
          hostname: hostname(),
        }
      }

      const endpoint = await deps.topology.resolveRemoteEndpointConnection(payload.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }

      try {
        const request = { kind: 'query' as const, id: 'system.homeDirectory', payload: null }
        const { result } = await invokeControlSurface(endpoint, request)

        if (!result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
          })
        }

        if (result.ok === false) {
          if (isUnknownControlSurfaceOperationError(result.error, request.id)) {
            return {
              endpointId: payload.endpointId,
              platform: 'unknown',
              homeDirectory: '/',
            }
          }

          throw createAppError(result.error)
        }

        const value = result.value as Partial<ControlSurfaceHomeDirectoryResult>
        const homeDirectory =
          typeof value.homeDirectory === 'string' && value.homeDirectory.trim().length > 0
            ? value.homeDirectory.trim()
            : '/'

        return {
          endpointId: payload.endpointId,
          platform: typeof value.platform === 'string' ? value.platform : 'unknown',
          homeDirectory: homeDirectory,
          ...(typeof value.hostname === 'string' &&
          /^[a-z0-9][a-z0-9._-]{0,252}$/i.test(value.hostname)
            ? { hostname: value.hostname }
            : {}),
        }
      } catch (error) {
        if (error instanceof OpenCoveAppError) {
          throw error
        }

        throw createAppError('worker.unavailable', {
          debugMessage:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, endpointReadDirectoryOperation, {
    handle: async (_ctx, payload): Promise<ReadEndpointDirectoryResult> => {
      if (payload.endpointId === 'local') {
        throw createAppError('common.unavailable', {
          debugMessage: 'endpoint.readDirectory only supports remote endpoints.',
        })
      }

      const endpoint = await deps.topology.resolveRemoteEndpointConnection(payload.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }

      try {
        const approveRequest = {
          kind: 'command' as const,
          id: 'workspace.approveRoot',
          payload: { path: payload.path },
        }
        const approve = await invokeControlSurface(endpoint, approveRequest)

        if (!approve.result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
          })
        }

        if (approve.result.ok === false) {
          if (!isUnknownControlSurfaceOperationError(approve.result.error, approveRequest.id)) {
            throw createAppError(approve.result.error)
          }
        }

        const { result } = await invokeControlSurface(endpoint, {
          kind: 'query',
          id: 'filesystem.readDirectory',
          payload: { uri: toFileUri(payload.path) },
        })

        if (!result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
          })
        }

        if (result.ok === false) {
          throw createAppError(result.error)
        }

        const value = result.value as { entries?: unknown }
        return {
          endpointId: payload.endpointId,
          path: payload.path,
          entries: Array.isArray(value.entries)
            ? (value.entries as ReadEndpointDirectoryResult['entries'])
            : [],
        }
      } catch (error) {
        if (error instanceof OpenCoveAppError) {
          throw error
        }

        throw createAppError('worker.unavailable', {
          debugMessage:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : `Remote endpoint unavailable: ${payload.endpointId}`,
        })
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, mountListOperation, {
    handle: async (_ctx, payload) => await deps.topology.listMounts(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, mountCreateOperation, {
    handle: async (_ctx, payload) => {
      if (payload.endpointId === 'local') {
        await deps.approvedWorkspaces.registerRoot(payload.rootPath)
      } else {
        void deps.topology
          .resolveRemoteEndpointConnection(payload.endpointId)
          .then(endpoint => {
            if (!endpoint) {
              return
            }

            return invokeControlSurface(endpoint, {
              kind: 'command',
              id: 'workspace.approveRoot',
              payload: { path: payload.rootPath },
            })
          })
          .then(resultEnvelope => {
            const result = resultEnvelope?.result
            if (!result) {
              return
            }

            if (result.ok === false) {
              return
            }
          })
          .catch(() => undefined)
      }

      return await deps.topology.createMount(payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, mountRemoveOperation, {
    handle: async (_ctx, payload) => await deps.topology.removeMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, mountPromoteOperation, {
    handle: async (_ctx, payload) => await deps.topology.promoteMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, mountTargetResolveOperation, {
    handle: async (_ctx, payload) => await deps.topology.resolveMountTarget(payload),
    defaultErrorCode: 'common.unexpected',
  })
}
