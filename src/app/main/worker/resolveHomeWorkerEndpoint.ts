import { app } from 'electron'
import type { HomeWorkerConfigDto, HomeWorkerMode } from '../../../shared/contracts/dto'
import type { ControlSurfaceRemoteEndpoint } from '../controlSurface/remote/controlSurfaceHttpClient'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'
import {
  createDefaultHomeWorkerConfig,
  ensureHomeWorkerConfig,
  readHomeWorkerConfig,
} from './homeWorkerConfig'
import { startLocalWorker } from './localWorkerManager'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

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

export interface HomeWorkerEndpointResolution {
  config: HomeWorkerConfigDto
  effectiveMode: HomeWorkerMode
  endpoint: ControlSurfaceRemoteEndpoint | null
  diagnostics: string[]
}

async function resolveLocalDiscoveryEndpoint(): Promise<ControlSurfaceRemoteEndpoint | null> {
  const workerConnection = await resolveControlSurfaceConnectionInfoFromUserData({
    userDataPath: app.getPath('userData'),
    fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
  })

  return workerConnection ? toEndpoint(workerConnection) : null
}

export async function resolveHomeWorkerEndpoint(options: {
  allowConfig: boolean
  allowStandaloneMode?: boolean
  allowRemoteMode?: boolean
}): Promise<HomeWorkerEndpointResolution> {
  const diagnostics: string[] = []

  const wantsWorkerClientMode = isTruthyEnv(process.env['OPENCOVE_WORKER_CLIENT'])
  if (!options.allowConfig && !wantsWorkerClientMode) {
    const config = createDefaultHomeWorkerConfig({
      allowStandaloneMode: options.allowStandaloneMode,
      allowRemoteMode: options.allowRemoteMode,
    })
    return { config, effectiveMode: config.mode, endpoint: null, diagnostics }
  }

  if (wantsWorkerClientMode) {
    const endpoint = await resolveLocalDiscoveryEndpoint()
    if (!endpoint) {
      diagnostics.push(
        'OPENCOVE_WORKER_CLIENT=1 but no worker control surface connection file was found.',
      )
      return {
        config: await readHomeWorkerConfig(app.getPath('userData'), {
          allowStandaloneMode: options.allowStandaloneMode,
          allowRemoteMode: options.allowRemoteMode,
        }),
        effectiveMode: 'standalone',
        endpoint: null,
        diagnostics,
      }
    }

    return {
      config: await readHomeWorkerConfig(app.getPath('userData'), {
        allowStandaloneMode: options.allowStandaloneMode,
        allowRemoteMode: options.allowRemoteMode,
      }),
      effectiveMode: 'local',
      endpoint,
      diagnostics,
    }
  }

  const config = options.allowConfig
    ? await ensureHomeWorkerConfig(app.getPath('userData'), {
        allowStandaloneMode: options.allowStandaloneMode,
        allowRemoteMode: options.allowRemoteMode,
      })
    : createDefaultHomeWorkerConfig({
        allowStandaloneMode: options.allowStandaloneMode,
        allowRemoteMode: options.allowRemoteMode,
      })

  if (config.mode === 'remote' && config.remote) {
    return {
      config,
      effectiveMode: 'remote',
      endpoint: toEndpoint(config.remote),
      diagnostics,
    }
  }

  if (config.mode === 'local') {
    try {
      const status = await startLocalWorker()
      if (status.status === 'running' && status.connection) {
        return {
          config,
          effectiveMode: 'local',
          endpoint: toEndpoint(status.connection),
          diagnostics,
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      diagnostics.push(`Failed to start local worker: ${detail}`)
    }

    diagnostics.push('Home worker mode is local but worker did not start.')
    return { config, effectiveMode: 'standalone', endpoint: null, diagnostics }
  }

  if (config.mode === 'standalone') {
    const localEndpoint = await resolveLocalDiscoveryEndpoint()
    if (localEndpoint) {
      diagnostics.push('Local worker is running; switching Desktop to worker client mode.')
      return { config, effectiveMode: 'local', endpoint: localEndpoint, diagnostics }
    }
  }

  return {
    config,
    effectiveMode: config.mode,
    endpoint: null,
    diagnostics,
  }
}
