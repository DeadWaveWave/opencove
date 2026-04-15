import { fileURLToPath } from 'node:url'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type { ResolveMountTargetResult } from '../../../../shared/contracts/dto'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'

type RemoteEndpointConnection = {
  hostname: string
  port: number
  token: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function normalizeMountId(value: unknown, operationId: string): string {
  const mountId = normalizeOptionalString(value)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} mountId.`,
    })
  }

  return mountId
}

export function normalizeFileSystemUri(uri: unknown, operationId: string): string {
  if (typeof uri !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  const normalized = uri.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} uri.`,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  if (parsed.protocol !== 'file:') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unsupported uri scheme for ${operationId}: ${parsed.protocol}`,
    })
  }

  return normalized
}

export function normalizeSourceTargetPayload<
  T extends { mountId: string; sourceUri: string; targetUri: string },
>(payload: unknown, operationId: string): T {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, operationId),
    sourceUri: normalizeFileSystemUri(payload.sourceUri, `${operationId}.sourceUri`),
    targetUri: normalizeFileSystemUri(payload.targetUri, `${operationId}.targetUri`),
  } as T
}

export function createApprovedUriAsserter(
  approvedWorkspaces: ApprovedWorkspaceStore,
): (uri: string, debugMessage: string) => Promise<void> {
  return async (uri, debugMessage) => {
    const path = fileURLToPath(uri)
    const isApproved = await approvedWorkspaces.isPathApproved(path)
    if (!isApproved) {
      throw createAppError('common.approved_path_required', { debugMessage })
    }
  }
}

export async function resolveMountTargetOrThrow(options: {
  topology: WorkerTopologyStore
  mountId: string
}): Promise<ResolveMountTargetResult> {
  const target = await options.topology.resolveMountTarget({ mountId: options.mountId })
  if (!target) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unknown mountId: ${options.mountId}`,
    })
  }

  return target
}

export function assertFileUriWithinMountRoot(options: {
  target: ResolveMountTargetResult
  uri: string
  debugMessage: string
}): void {
  assertFileUriWithinRootUri({
    rootUri: options.target.rootUri,
    uri: options.uri,
    debugMessage: options.debugMessage,
  })
}

async function resolveRemoteOrThrow(
  topology: WorkerTopologyStore,
  endpointId: string,
): Promise<RemoteEndpointConnection> {
  const endpoint = await topology.resolveRemoteEndpointConnection(endpointId)
  if (!endpoint) {
    throw createAppError('worker.unavailable', {
      debugMessage: `Remote endpoint unavailable: ${endpointId}`,
    })
  }

  return endpoint
}

export async function invokeRemoteValue<TResult>(options: {
  topology: WorkerTopologyStore
  endpointId: string
  id: string
  kind: 'query' | 'command'
  payload: unknown
}): Promise<TResult> {
  const endpoint = await resolveRemoteOrThrow(options.topology, options.endpointId)

  try {
    const { result } = await invokeControlSurface(endpoint, {
      kind: options.kind,
      id: options.id,
      payload: options.payload,
    })

    if (!result) {
      throw createAppError('worker.unavailable', {
        debugMessage: `Remote control surface unavailable: ${options.endpointId}`,
      })
    }

    if (result.ok === false) {
      throw createAppError(result.error)
    }

    return result.value as TResult
  } catch (error) {
    if (error instanceof OpenCoveAppError) {
      throw error
    }

    throw createAppError('worker.unavailable', {
      debugMessage:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : `Remote control surface unavailable: ${options.endpointId}`,
    })
  }
}
