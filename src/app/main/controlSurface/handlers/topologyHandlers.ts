import type { ControlSurface } from '../controlSurface'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type {
  ControlSurfaceHomeDirectoryResult,
  CreateMountInput,
  GetEndpointHomeDirectoryInput,
  GetEndpointHomeDirectoryResult,
  ListMountsInput,
  PingWorkerEndpointInput,
  PingWorkerEndpointResult,
  PromoteMountInput,
  ReadEndpointDirectoryInput,
  ReadEndpointDirectoryResult,
  RegisterWorkerEndpointInput,
  RemoveMountInput,
  RemoveWorkerEndpointInput,
  ResolveMountTargetInput,
} from '../../../../shared/contracts/dto'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import type { AppErrorDescriptor } from '../../../../shared/contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isUnknownControlSurfaceOperationError(
  error: AppErrorDescriptor | null | undefined,
  operationId: string,
): boolean {
  if (!error) {
    return false
  }

  if (error.code !== 'common.invalid_input') {
    return false
  }

  const debugMessage = typeof error.debugMessage === 'string' ? error.debugMessage : ''
  return debugMessage.includes('Unknown control surface') && debugMessage.includes(operationId)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }

  return normalized
}

function normalizeRequiredPort(value: unknown, debugName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  const port = Math.floor(value)
  if (port <= 0 || port > 65_535) {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  return port
}

function isAbsolutePathLike(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)
}

function normalizeRequiredAbsolutePath(value: unknown, debugName: string): string {
  const path = normalizeRequiredString(value, debugName)
  if (!isAbsolutePathLike(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${debugName} requires an absolute path`,
    })
  }

  return path
}

function normalizeRegisterEndpointPayload(payload: unknown): RegisterWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.register.',
    })
  }

  return {
    displayName: normalizeOptionalString(payload.displayName),
    hostname: normalizeRequiredString(payload.hostname, 'endpoint.register hostname'),
    port: normalizeRequiredPort(payload.port, 'endpoint.register port'),
    token: normalizeRequiredString(payload.token, 'endpoint.register token'),
  }
}

function normalizeRemoveEndpointPayload(payload: unknown): RemoveWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.remove.',
    })
  }

  return { endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.remove endpointId') }
}

function normalizeListMountsPayload(payload: unknown): ListMountsInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.list.',
    })
  }

  return {
    projectId: normalizeRequiredString(payload.projectId, 'mount.list projectId'),
  }
}

function normalizeCreateMountPayload(payload: unknown): CreateMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.create.',
    })
  }

  return {
    projectId: normalizeRequiredString(payload.projectId, 'mount.create projectId'),
    name: normalizeOptionalString(payload.name),
    endpointId: normalizeRequiredString(payload.endpointId, 'mount.create endpointId'),
    rootPath: normalizeRequiredString(payload.rootPath, 'mount.create rootPath'),
  }
}

function normalizeRemoveMountPayload(payload: unknown): RemoveMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.remove.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.remove mountId') }
}

function normalizePromoteMountPayload(payload: unknown): PromoteMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.promote.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.promote mountId') }
}

function normalizeResolveMountTargetPayload(payload: unknown): ResolveMountTargetInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mountTarget.resolve.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mountTarget.resolve mountId') }
}

function normalizePingEndpointPayload(payload: unknown): PingWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.ping.',
    })
  }

  const timeoutMsRaw = payload.timeoutMs
  const timeoutMs =
    typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.floor(timeoutMsRaw)
      : null

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.ping endpointId'),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  }
}

function normalizeEndpointHomeDirectoryPayload(payload: unknown): GetEndpointHomeDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.homeDirectory.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.homeDirectory endpointId'),
  }
}

function normalizeEndpointReadDirectoryPayload(payload: unknown): ReadEndpointDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.readDirectory.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.readDirectory endpointId'),
    path: normalizeRequiredAbsolutePath(payload.path, 'endpoint.readDirectory path'),
  }
}

export function registerTopologyHandlers(
  controlSurface: ControlSurface,
  deps: { topology: WorkerTopologyStore; approvedWorkspaces: ApprovedWorkspaceStore },
): void {
  controlSurface.register('endpoint.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async () => await deps.topology.listEndpoints(),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('endpoint.register', {
    kind: 'command',
    validate: normalizeRegisterEndpointPayload,
    handle: async (_ctx, payload) => await deps.topology.registerEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('endpoint.remove', {
    kind: 'command',
    validate: normalizeRemoveEndpointPayload,
    handle: async (_ctx, payload) => await deps.topology.removeEndpoint(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('endpoint.ping', {
    kind: 'query',
    validate: normalizePingEndpointPayload,
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

  controlSurface.register('endpoint.homeDirectory', {
    kind: 'query',
    validate: normalizeEndpointHomeDirectoryPayload,
    handle: async (_ctx, payload): Promise<GetEndpointHomeDirectoryResult> => {
      if (payload.endpointId === 'local') {
        return {
          endpointId: 'local',
          platform: process.platform,
          homeDirectory: resolveHomeDirectory(),
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

  controlSurface.register('endpoint.readDirectory', {
    kind: 'query',
    validate: normalizeEndpointReadDirectoryPayload,
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

  controlSurface.register('mount.list', {
    kind: 'query',
    validate: normalizeListMountsPayload,
    handle: async (_ctx, payload) => await deps.topology.listMounts(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mount.create', {
    kind: 'command',
    validate: normalizeCreateMountPayload,
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

  controlSurface.register('mount.remove', {
    kind: 'command',
    validate: normalizeRemoveMountPayload,
    handle: async (_ctx, payload) => await deps.topology.removeMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mount.promote', {
    kind: 'command',
    validate: normalizePromoteMountPayload,
    handle: async (_ctx, payload) => await deps.topology.promoteMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mountTarget.resolve', {
    kind: 'query',
    validate: normalizeResolveMountTargetPayload,
    handle: async (_ctx, payload) => await deps.topology.resolveMountTarget(payload),
    defaultErrorCode: 'common.unexpected',
  })
}
