import type { HomeWorkerConfigDto, HomeWorkerMode } from '../../../shared/contracts/dto'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'
import type {
  ControlSurfaceRemoteEndpoint,
  ControlSurfaceRemoteEndpointResolver,
} from '../controlSurface/remote/controlSurfaceHttpClient'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'

function toEndpoint(value: {
  hostname: string
  port: number
  token: string
}): ControlSurfaceRemoteEndpoint {
  return {
    hostname: value.hostname,
    port: value.port,
    token: value.token,
  }
}

async function resolveLocalWorkerEndpoint(
  userDataPath: string,
): Promise<ControlSurfaceRemoteEndpoint | null> {
  const connection = await resolveControlSurfaceConnectionInfoFromUserData({
    userDataPath,
    fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
  })

  return connection ? toEndpoint(connection) : null
}

export function createHomeWorkerEndpointResolver(options: {
  userDataPath: string
  config: HomeWorkerConfigDto
  effectiveMode: HomeWorkerMode
  initialEndpoint?: ControlSurfaceRemoteEndpoint | null
}): ControlSurfaceRemoteEndpointResolver {
  if (options.effectiveMode === 'remote') {
    const endpoint =
      options.initialEndpoint ?? (options.config.remote ? toEndpoint(options.config.remote) : null)
    return async () => endpoint
  }

  if (options.effectiveMode === 'local') {
    let cachedEndpoint = options.initialEndpoint ?? null
    return async () => {
      const resolved = await resolveLocalWorkerEndpoint(options.userDataPath)
      if (resolved) {
        cachedEndpoint = resolved
      }
      return cachedEndpoint
    }
  }

  return async () => null
}
