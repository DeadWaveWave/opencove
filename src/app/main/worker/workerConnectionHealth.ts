import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'

export interface WorkerConnectionHealthTarget {
  hostname: string
  port: number
  token: string
}

export async function isWorkerConnectionAlive(
  connection: WorkerConnectionHealthTarget,
): Promise<boolean> {
  try {
    const endpoint = {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    }

    const pingResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.ping', payload: null },
      { timeoutMs: 750 },
    )
    if (pingResponse.httpStatus !== 200 || pingResponse.result?.ok !== true) {
      return false
    }

    const capabilitiesResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.capabilities', payload: null },
      { timeoutMs: 750 },
    )
    if (capabilitiesResponse.httpStatus !== 200 || capabilitiesResponse.result?.ok !== true) {
      return false
    }

    const capabilities = capabilitiesResponse.result.value
    const protocolVersion =
      capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
        ? (capabilities as Record<string, unknown>).protocolVersion
        : null
    if (protocolVersion !== CONTROL_SURFACE_PROTOCOL_VERSION) {
      return false
    }

    const endpointsResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'endpoint.list', payload: null },
      { timeoutMs: 750 },
    )

    return endpointsResponse.httpStatus === 200 && endpointsResponse.result?.ok === true
  } catch {
    return false
  }
}
