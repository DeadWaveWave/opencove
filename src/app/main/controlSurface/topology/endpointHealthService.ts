import type { ManagedSshEndpointOperationOwner } from '../../../../contexts/topology/application/ManagedSshEndpointOperationOwner'
import { managedSshDiagnosticDetails } from './managedSshDiagnosticDetails'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../../shared/contracts/controlSurface'
import type {
  ListWorkerEndpointOverviewsResult,
  PrepareWorkerEndpointInput,
  PrepareWorkerEndpointResult,
  RepairWorkerEndpointInput,
  RepairWorkerEndpointResult,
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
import {
  buildOverview,
  emptyRuntime,
  makeMissingEndpoint,
  projectManagedRuntimeFailure,
  recommendedActionForAccessStatus,
} from './endpointHealthProjection'

type ProbedRuntime = WorkerEndpointOverviewDto['runtime']

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
  operations: ManagedSshEndpointOperationOwner
}): EndpointHealthService {
  const buildOverviewForAccess = async (
    access: EndpointRuntimeAccess,
    dependentMountCount: number,
  ): Promise<WorkerEndpointOverviewDto> => {
    if (access.kind === 'manual') {
      const probed = await probeEndpointConnection(access.connection)
      return buildOverview(access.endpoint, {
        status: probed.status,
        details: probed.details,
        runtime: probed.runtime,
        recommendedAction: recommendedActionForAccessStatus(access, probed.status),
        canBrowse: probed.status === 'connected',
        dependentMountCount,
      })
    }

    const operation = options.operations.getSnapshot(access.endpoint.endpointId)
    if (operation) {
      return buildOverview(access.endpoint, {
        status: 'connecting',
        operation,
        details: [],
        recommendedAction: 'show_details',
        dependentMountCount,
      })
    }

    const snapshot = options.managedRuntime.getSnapshot(access.endpoint.endpointId)
    if (!snapshot) {
      return buildOverview(access.endpoint, {
        status: 'disconnected',
        details: ['Ready to connect over SSH.'],
        recommendedAction: 'connect',
        dependentMountCount,
      })
    }

    if (snapshot.status === 'connecting') {
      return buildOverview(access.endpoint, {
        status: 'connecting',
        details: [],
        recommendedAction: 'show_details',
        dependentMountCount,
      })
    }

    if (snapshot.status === 'error') {
      const details = managedSshDiagnosticDetails(
        [snapshot.lastError ?? 'SSH tunnel failed.', snapshot.stderrTail],
        access.token,
      )
      const failure = projectManagedRuntimeFailure(snapshot)
      return buildOverview(access.endpoint, {
        status: failure.status,
        details,
        recommendedAction: failure.recommendedAction,
        dependentMountCount,
      })
    }

    if (snapshot.status !== 'ready' || snapshot.localPort === null) {
      return buildOverview(access.endpoint, {
        status: 'disconnected',
        details: ['Ready to connect over SSH.'],
        recommendedAction: 'connect',
        dependentMountCount,
      })
    }

    const probed = await probeEndpointConnection({
      hostname: '127.0.0.1',
      port: snapshot.localPort,
      token: access.token,
    })

    // A command can start (and retire the tunnel) while a previous health probe is in flight.
    const current = options.managedRuntime.getSnapshot(access.endpoint.endpointId)
    if (
      options.operations.getSnapshot(access.endpoint.endpointId) ||
      current?.status !== snapshot.status ||
      current?.localPort !== snapshot.localPort
    ) {
      return await buildOverviewForAccess(access, dependentMountCount)
    }
    const status = probed.status === 'disconnected' ? 'needs_setup' : probed.status
    return buildOverview(access.endpoint, {
      status,
      details: probed.details,
      runtime: probed.runtime,
      recommendedAction: recommendedActionForAccessStatus(access, status),
      canBrowse: status === 'connected',
      dependentMountCount,
    })
  }

  return {
    listOverviews: async (): Promise<ListWorkerEndpointOverviewsResult> => {
      const endpoints = await options.topology.listEndpoints()
      const [persistenceIssue, impactByEndpointId] = await Promise.all([
        options.topology.getPersistenceIssue?.(),
        options.topology.getEndpointRemovalImpacts(
          endpoints.endpoints.map(endpoint => endpoint.endpointId),
        ),
      ])
      const overviews = await Promise.all(
        endpoints.endpoints.map(async endpoint => {
          const impact = impactByEndpointId.get(endpoint.endpointId) ?? {
            mountIds: [],
            mountCount: 0,
          }
          if (endpoint.endpointId === 'local' && persistenceIssue) {
            return buildOverview(endpoint, {
              status: 'persistence_failed',
              details: [],
              recommendedAction: 'retry',
              canBrowse: false,
              dependentMountCount: impact.mountCount,
            })
          }

          const access = await options.topology.resolveEndpointRuntimeAccess(endpoint.endpointId)
          if (!access) {
            return buildOverview(endpoint, {
              status: 'connected',
              details: [],
              recommendedAction: 'none',
              canBrowse: endpoint.endpointId === 'local',
              summary:
                endpoint.endpointId === 'local' ? 'Local endpoint.' : 'Endpoint unavailable.',
              dependentMountCount: impact.mountCount,
            })
          }

          return await buildOverviewForAccess(access, impact.mountCount)
        }),
      )

      return {
        endpoints: overviews.map(overview => {
          const operation = options.operations.getSnapshot(overview.endpoint.endpointId)
          return operation
            ? buildOverview(overview.endpoint, {
                operation,
                status: 'connecting',
                details: [],
                recommendedAction: 'show_details',
                dependentMountCount: overview.dependentMountCount,
              })
            : overview
        }),
      }
    },

    prepareEndpoint: async (
      input: PrepareWorkerEndpointInput,
    ): Promise<PrepareWorkerEndpointResult> => {
      const assertAdmission = options.operations.captureAdmission(input.endpointId)
      const access = await options.topology.resolveEndpointRuntimeAccess(input.endpointId)
      const impact = await options.topology.getEndpointRemovalImpact(input.endpointId)
      if (!access) {
        const endpoint = (await options.topology.listEndpoints()).endpoints.find(
          candidate => candidate.endpointId === input.endpointId,
        )
        return {
          overview: buildOverview(endpoint ?? makeMissingEndpoint(input.endpointId), {
            status: 'error',
            details: ['Endpoint not found.'],
            recommendedAction: 'retry',
            dependentMountCount: impact.mountCount,
          }),
        }
      }

      if (access.kind === 'manual') {
        return { overview: await buildOverviewForAccess(access, impact.mountCount) }
      }

      assertAdmission()
      const operation = options.operations.start({
        kind: 'prepare',
        access: toManagedRuntimeAccess(access),
        restartTunnel: input.reason === 'reconnect',
        reinstallRuntime: false,
      })
      return {
        overview: buildOverview(access.endpoint, {
          status: 'connecting',
          operation,
          recommendedAction: 'show_details',
          dependentMountCount: impact.mountCount,
        }),
      }
    },

    repairEndpoint: async (
      input: RepairWorkerEndpointInput,
    ): Promise<RepairWorkerEndpointResult> => {
      const impact = await options.topology.getEndpointRemovalImpact(input.endpointId)
      if (
        input.endpointId === 'local' &&
        input.action === 'retry' &&
        options.topology.retryPersistence
      ) {
        await options.topology.retryPersistence()
        const endpoint = (await options.topology.listEndpoints()).endpoints.find(
          candidate => candidate.endpointId === 'local',
        )
        const issue = await options.topology.getPersistenceIssue?.()
        return {
          overview: buildOverview(endpoint ?? makeMissingEndpoint('local'), {
            status: issue ? 'persistence_failed' : 'connected',
            details: [],
            recommendedAction: issue ? 'retry' : 'none',
            canBrowse: !issue,
            summary: issue ? 'A topology change was not saved.' : 'Local endpoint.',
            dependentMountCount: impact.mountCount,
          }),
        }
      }

      const assertAdmission = options.operations.captureAdmission(input.endpointId)
      const access = await options.topology.resolveEndpointRuntimeAccess(input.endpointId)
      if (!access) {
        return {
          overview: buildOverview(makeMissingEndpoint(input.endpointId), {
            status: 'error',
            details: ['Endpoint not found.'],
            recommendedAction: 'retry',
            dependentMountCount: impact.mountCount,
          }),
        }
      }

      if (access.kind === 'manual') {
        return { overview: await buildOverviewForAccess(access, impact.mountCount) }
      }

      assertAdmission()
      const operation = options.operations.start({
        kind: 'repair',
        access: toManagedRuntimeAccess(access),
        restartTunnel:
          input.action === 'repair_credentials' ||
          input.action === 'repair_tunnel' ||
          input.action === 'retry',
        reinstallRuntime: input.action === 'update_runtime' || input.action === 'install_runtime',
      })
      return {
        overview: buildOverview(access.endpoint, {
          status: 'connecting',
          operation,
          recommendedAction: 'show_details',
          dependentMountCount: impact.mountCount,
        }),
      }
    },
  }
}
