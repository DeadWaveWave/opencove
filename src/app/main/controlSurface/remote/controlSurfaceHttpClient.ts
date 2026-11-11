import { remoteSpawnObservation } from '../remoteSpawnObservation'
import { canvasSpawnIdentity, canvasSpawnOperations } from '../sessionSpawnIdentityContext'
import type {
  ControlSurfaceInvokeRequest,
  ControlSurfaceInvokeResult,
} from '../../../../shared/contracts/controlSurface'

export interface ControlSurfaceRemoteEndpoint {
  hostname: string
  port: number
  token: string
}

export type ControlSurfaceRemoteEndpointResolver =
  () => Promise<ControlSurfaceRemoteEndpoint | null>

export async function invokeControlSurface(
  endpoint: ControlSurfaceRemoteEndpoint,
  request: ControlSurfaceInvokeRequest,
  options: { timeoutMs?: number } = {},
): Promise<{ httpStatus: number; result: ControlSurfaceInvokeResult<unknown> | null }> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `http://${endpoint.hostname}:${endpoint.port}/invoke`
    if (canvasSpawnOperations.has(request.id)) {
      const nodeId = canvasSpawnIdentity.getStore()?.nodeId
      if (nodeId) {
        remoteSpawnObservation.getStore()?.(nodeId)
      }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canvasSpawnOperations.has(request.id) && canvasSpawnIdentity.getStore()
          ? {
              ...request,
              payload: {
                ...(request.payload as object),
                workerSpawnIdentity: (() => {
                  const identity = canvasSpawnIdentity.getStore()!
                  return {
                    projectId: identity.projectId,
                    spaceId: identity.spaceId,
                    nodeId: identity.nodeId,
                  }
                })(),
              },
            }
          : request,
      ),
      signal: controller.signal,
    })

    const raw = await response.text()
    const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown) : null

    const result =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).__opencoveControlEnvelope === true
        ? (parsed as ControlSurfaceInvokeResult<unknown>)
        : null

    return { httpStatus: response.status, result }
  } finally {
    clearTimeout(timer)
  }
}
