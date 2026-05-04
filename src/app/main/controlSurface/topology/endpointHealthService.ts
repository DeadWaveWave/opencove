import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../../shared/contracts/controlSurface'
import type {
  ListWorkerEndpointOverviewsResult,
  PrepareWorkerEndpointInput,
  PrepareWorkerEndpointResult,
  RepairWorkerEndpointInput,
  RepairWorkerEndpointResult,
  WorkerEndpointDto,
  WorkerEndpointHealthActionDto,
  WorkerEndpointHealthStatusDto,
  WorkerEndpointOverviewDto,
} from '../../../../shared/contracts/dto'
import type { ManagedSshEndpointRuntime } from './managedSshEndpointRuntime'
import type {
  EndpointRuntimeAccess,
  ManagedSshEndpointRuntimeAccess,
} from './topologyEndpointAccess'
import type { WorkerTopologyStore } from './topologyStore'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'

type ProbedRuntime = WorkerEndpointOverviewDto['runtime']

function emptyRuntime(): ProbedRuntime {
  return {
    appVersion: null,
    protocolVersion: null,
    platform: null,
    pid: null,
  }
}

function buildOverview(
  access: EndpointRuntimeAccess['endpoint'],
  options: {
    status: WorkerEndpointHealthStatusDto
    details?: string[]
    checkedAt?: string
    recommendedAction: WorkerEndpointHealthActionDto
    canBrowse?: boolean
    runtime?: ProbedRuntime
    summary?: string
  },
): WorkerEndpointOverviewDto {
  return {
    endpoint: access,
    status: options.status,
    summary:
      options.summary ??
      (
        {
          connected: 'Connected.',
          connecting: 'Connecting…',
          disconnected: 'Not connected.',
          auth_failed: 'Authentication failed.',
          tunnel_failed: 'SSH tunnel failed.',
          needs_setup: 'Remote runtime needs setup.',
          version_mismatch: 'Remote runtime is incompatible with this OpenCove version.',
          error: 'Endpoint error.',
        } satisfies Record<WorkerEndpointHealthStatusDto, string>
      )[options.status],
    details: options.details ?? [],
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    recommendedAction: options.recommendedAction,
    isManaged: access.access?.kind === 'managed_ssh',
    canBrowse: options.canBrowse ?? false,
    runtime: options.runtime ?? emptyRuntime(),
  }
}

async function probeEndpointConnection(connection: {
  hostname: string
  port: number
  token: string
}): Promise<{
  status: WorkerEndpointHealthStatusDto
  details: string[]
  runtime: ProbedRuntime
}> {
  try {
    const response = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'system.capabilities', payload: null },
      { timeoutMs: 1_250 },
    )

    if (response.httpStatus === 401 || response.httpStatus === 403) {
      return {
        status: 'auth_failed',
        details: ['The stored token was rejected by the remote worker.'],
        runtime: emptyRuntime(),
      }
    }

    if (response.httpStatus !== 200 || !response.result) {
      return {
        status: 'disconnected',
        details: [`Remote endpoint returned HTTP ${String(response.httpStatus)}.`],
        runtime: emptyRuntime(),
      }
    }

    if (response.result.ok === false) {
      if (response.result.error.code === 'control_surface.unauthorized') {
        return {
          status: 'auth_failed',
          details: ['The stored token was rejected by the remote worker.'],
          runtime: emptyRuntime(),
        }
      }

      return {
        status: 'version_mismatch',
        details: [
          response.result.error.debugMessage?.trim() ||
            'Remote worker did not expose a compatible system.capabilities response.',
        ],
        runtime: emptyRuntime(),
      }
    }

    const value = response.result.value as Record<string, unknown>
    const protocolVersion =
      typeof value.protocolVersion === 'number' && Number.isFinite(value.protocolVersion)
        ? Math.floor(value.protocolVersion)
        : null
    const appVersion = typeof value.appVersion === 'string' ? value.appVersion.trim() : null
    const pid =
      typeof value.pid === 'number' && Number.isFinite(value.pid) ? Math.floor(value.pid) : null
    const runtime: ProbedRuntime = {
      appVersion: appVersion && appVersion.length > 0 ? appVersion : null,
      protocolVersion,
      platform: null,
      pid,
    }

    if (protocolVersion !== CONTROL_SURFACE_PROTOCOL_VERSION) {
      return {
        status: 'version_mismatch',
        details: [
          `Protocol mismatch: expected ${String(CONTROL_SURFACE_PROTOCOL_VERSION)}, received ${String(protocolVersion ?? 'unknown')}.`,
        ],
        runtime,
      }
    }

    return {
      status: 'connected',
      details: appVersion ? [`Remote runtime version ${appVersion}.`] : [],
      runtime,
    }
  } catch (error) {
    return {
      status: 'disconnected',
      details: [error instanceof Error ? error.message : String(error)],
      runtime: emptyRuntime(),
    }
  }
}

function recommendedActionForStatus(
  status: WorkerEndpointHealthStatusDto,
): WorkerEndpointHealthActionDto {
  switch (status) {
    case 'connected':
      return 'browse'
    case 'connecting':
      return 'show_details'
    case 'disconnected':
      return 'connect'
    case 'auth_failed':
      return 'repair_credentials'
    case 'tunnel_failed':
      return 'repair_tunnel'
    case 'needs_setup':
      return 'install_runtime'
    case 'version_mismatch':
      return 'update_runtime'
    case 'error':
    default:
      return 'retry'
  }
}

function makeMissingEndpoint(endpointId: string): WorkerEndpointDto {
  return {
    endpointId,
    kind: 'remote_worker',
    displayName: endpointId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    access: null,
    remote: null,
  }
}

function toManagedRuntimeAccess(
  access: Extract<EndpointRuntimeAccess, { kind: 'managed_ssh' }>,
): ManagedSshEndpointRuntimeAccess {
  return {
    endpointId: access.endpoint.endpointId,
    displayName: access.endpoint.displayName,
    token: access.token,
    ssh: access.managedSsh,
  }
}

export interface EndpointHealthService {
  listOverviews: () => Promise<ListWorkerEndpointOverviewsResult>
  prepareEndpoint: (input: PrepareWorkerEndpointInput) => Promise<PrepareWorkerEndpointResult>
  repairEndpoint: (input: RepairWorkerEndpointInput) => Promise<RepairWorkerEndpointResult>
}

export function createEndpointHealthService(options: {
  topology: WorkerTopologyStore
  managedRuntime: ManagedSshEndpointRuntime
}): EndpointHealthService {
  const buildOverviewForAccess = async (
    access: EndpointRuntimeAccess,
  ): Promise<WorkerEndpointOverviewDto> => {
    if (access.kind === 'manual') {
      const probed = await probeEndpointConnection(access.connection)
      return buildOverview(access.endpoint, {
        status: probed.status,
        details: probed.details,
        runtime: probed.runtime,
        recommendedAction: recommendedActionForStatus(probed.status),
        canBrowse: probed.status === 'connected',
      })
    }

    const snapshot = options.managedRuntime.getSnapshot(access.endpoint.endpointId)
    if (!snapshot) {
      return buildOverview(access.endpoint, {
        status: 'disconnected',
        details: ['Ready to connect over SSH.'],
        recommendedAction: 'connect',
      })
    }

    if (snapshot.status === 'connecting') {
      return buildOverview(access.endpoint, {
        status: 'connecting',
        details: snapshot.stderrTail.trim().length > 0 ? [snapshot.stderrTail.trim()] : [],
        recommendedAction: 'show_details',
      })
    }

    if (snapshot.status === 'error') {
      const details = [snapshot.lastError ?? 'SSH tunnel failed.']
      if (snapshot.stderrTail.trim().length > 0) {
        details.push(snapshot.stderrTail.trim())
      }
      return buildOverview(access.endpoint, {
        status: 'tunnel_failed',
        details,
        recommendedAction: 'repair_tunnel',
      })
    }

    if (snapshot.status !== 'ready' || snapshot.localPort === null) {
      return buildOverview(access.endpoint, {
        status: 'disconnected',
        details: ['Ready to connect over SSH.'],
        recommendedAction: 'connect',
      })
    }

    const probed = await probeEndpointConnection({
      hostname: '127.0.0.1',
      port: snapshot.localPort,
      token: access.token,
    })

    const status = probed.status === 'disconnected' ? 'needs_setup' : probed.status
    return buildOverview(access.endpoint, {
      status,
      details: probed.details,
      runtime: probed.runtime,
      recommendedAction: recommendedActionForStatus(status),
      canBrowse: status === 'connected',
    })
  }

  return {
    listOverviews: async (): Promise<ListWorkerEndpointOverviewsResult> => {
      const endpoints = await options.topology.listEndpoints()
      const overviews = await Promise.all(
        endpoints.endpoints.map(async endpoint => {
          const access = await options.topology.resolveEndpointRuntimeAccess(endpoint.endpointId)
          if (!access) {
            return buildOverview(endpoint, {
              status: 'connected',
              details: [],
              recommendedAction: 'none',
              canBrowse: endpoint.endpointId === 'local',
              summary:
                endpoint.endpointId === 'local' ? 'Local endpoint.' : 'Endpoint unavailable.',
            })
          }

          return await buildOverviewForAccess(access)
        }),
      )

      return { endpoints: overviews }
    },

    prepareEndpoint: async (
      input: PrepareWorkerEndpointInput,
    ): Promise<PrepareWorkerEndpointResult> => {
      const access = await options.topology.resolveEndpointRuntimeAccess(input.endpointId)
      if (!access) {
        const endpoint = (await options.topology.listEndpoints()).endpoints.find(
          candidate => candidate.endpointId === input.endpointId,
        )
        return {
          overview: buildOverview(endpoint ?? makeMissingEndpoint(input.endpointId), {
            status: 'error',
            details: ['Endpoint not found.'],
            recommendedAction: 'retry',
          }),
        }
      }

      if (access.kind === 'manual') {
        return { overview: await buildOverviewForAccess(access) }
      }

      const prepared = await options.managedRuntime.prepare(toManagedRuntimeAccess(access), {
        restartTunnel: input.reason === 'reconnect',
        allowBootstrap: true,
      })
      if (prepared.connection) {
        const probed = await probeEndpointConnection(prepared.connection)
        return {
          overview: buildOverview(access.endpoint, {
            status: probed.status,
            details: probed.details,
            runtime: probed.runtime,
            recommendedAction: recommendedActionForStatus(probed.status),
            canBrowse: probed.status === 'connected',
          }),
        }
      }

      const snapshot = prepared.snapshot
      return {
        overview: buildOverview(access.endpoint, {
          status: snapshot.status === 'error' ? 'tunnel_failed' : 'needs_setup',
          details: [snapshot.lastError ?? 'Remote runtime is not ready yet.'],
          recommendedAction: snapshot.status === 'error' ? 'repair_tunnel' : 'install_runtime',
        }),
      }
    },

    repairEndpoint: async (
      input: RepairWorkerEndpointInput,
    ): Promise<RepairWorkerEndpointResult> => {
      const access = await options.topology.resolveEndpointRuntimeAccess(input.endpointId)
      if (!access) {
        return {
          overview: buildOverview(makeMissingEndpoint(input.endpointId), {
            status: 'error',
            details: ['Endpoint not found.'],
            recommendedAction: 'retry',
          }),
        }
      }

      if (access.kind === 'manual') {
        return { overview: await buildOverviewForAccess(access) }
      }

      const prepared = await options.managedRuntime.prepare(toManagedRuntimeAccess(access), {
        restartTunnel: input.action === 'repair_tunnel' || input.action === 'retry',
        reinstallRuntime: input.action === 'update_runtime' || input.action === 'install_runtime',
        allowBootstrap: true,
      })

      if (prepared.connection) {
        const probed = await probeEndpointConnection(prepared.connection)
        return {
          overview: buildOverview(access.endpoint, {
            status: probed.status,
            details: probed.details,
            runtime: probed.runtime,
            recommendedAction: recommendedActionForStatus(probed.status),
            canBrowse: probed.status === 'connected',
          }),
        }
      }

      return {
        overview: buildOverview(access.endpoint, {
          status: prepared.snapshot.status === 'error' ? 'tunnel_failed' : 'error',
          details: [prepared.snapshot.lastError ?? 'Remote repair did not finish successfully.'],
          recommendedAction: recommendedActionForStatus(
            prepared.snapshot.status === 'error' ? 'tunnel_failed' : 'error',
          ),
        }),
      }
    },
  }
}
