import type { ControlSurface } from '../controlSurface'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type {
  CreateMountInput,
  ListMountsInput,
  PingWorkerEndpointInput,
  PingWorkerEndpointResult,
  RegisterWorkerEndpointInput,
  RemoveMountInput,
  RemoveWorkerEndpointInput,
  ResolveMountTargetInput,
} from '../../../../shared/contracts/dto'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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

  return { spaceId: normalizeRequiredString(payload.spaceId, 'mount.list spaceId') }
}

function normalizeCreateMountPayload(payload: unknown): CreateMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.create.',
    })
  }

  return {
    spaceId: normalizeRequiredString(payload.spaceId, 'mount.create spaceId'),
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

export function registerTopologyHandlers(
  controlSurface: ControlSurface,
  deps: { topology: WorkerTopologyStore },
): void {
  controlSurface.register('endpoint.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async (): Promise<ReturnType<WorkerTopologyStore['listEndpoints']>> => {
      return deps.topology.listEndpoints()
    },
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
        const { result } = await invokeControlSurface(
          endpoint,
          { kind: 'query', id: 'system.ping', payload: null },
          { timeoutMs: payload.timeoutMs ?? undefined },
        )

        if (!result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote control surface unavailable: ${payload.endpointId}`,
          })
        }

        if (result.ok === false) {
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

  controlSurface.register('mount.list', {
    kind: 'query',
    validate: normalizeListMountsPayload,
    handle: async (_ctx, payload) => await deps.topology.listMounts(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mount.create', {
    kind: 'command',
    validate: normalizeCreateMountPayload,
    handle: async (_ctx, payload) => await deps.topology.createMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mount.remove', {
    kind: 'command',
    validate: normalizeRemoveMountPayload,
    handle: async (_ctx, payload) => await deps.topology.removeMount(payload),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('mountTarget.resolve', {
    kind: 'query',
    validate: normalizeResolveMountTargetPayload,
    handle: async (_ctx, payload) => await deps.topology.resolveMountTarget(payload),
    defaultErrorCode: 'common.unexpected',
  })
}
