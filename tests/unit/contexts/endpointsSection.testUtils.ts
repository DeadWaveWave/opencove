import { vi } from 'vitest'
import type { SshConfigHost, WorkerEndpointOverviewDto } from '../../../src/shared/contracts/dto'

export function createOverview(
  overrides: Partial<WorkerEndpointOverviewDto>,
): WorkerEndpointOverviewDto {
  return {
    endpoint: {
      endpointId: 'local',
      kind: 'local',
      displayName: 'Local',
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
      access: null,
      remote: null,
      ...(overrides.endpoint ?? {}),
    },
    status: 'connected',
    summary: 'Connected.',
    details: [],
    checkedAt: '2026-04-15T00:00:00.000Z',
    recommendedAction: 'none',
    isManaged: false,
    canBrowse: false,
    dependentMountCount: 0,
    runtime: {
      appVersion: null,
      protocolVersion: null,
      platform: null,
      pid: null,
    },
    ...overrides,
  }
}

export function installEndpointsApi(
  options: {
    localOverview?: WorkerEndpointOverviewDto
    managedOverrides?: Partial<WorkerEndpointOverviewDto>
    overviewError?: Error
    overviewGate?: Promise<void>
    sshConfigHosts?: SshConfigHost[]
  } = {},
): { invoke: ReturnType<typeof vi.fn> } {
  const overviews: WorkerEndpointOverviewDto[] = [
    options.localOverview ?? createOverview({}),
    createOverview({
      endpoint: {
        endpointId: 'managed-1',
        kind: 'remote_worker',
        displayName: 'SSH Box',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
        access: {
          kind: 'managed_ssh',
          managedSsh: {
            host: 'example.com',
            port: 22,
            username: 'ubuntu',
            remotePort: 39291,
            remotePlatform: 'auto',
          },
        },
        remote: null,
      },
      status: 'disconnected',
      summary: 'Not connected.',
      recommendedAction: 'connect',
      isManaged: true,
      dependentMountCount: 2,
      ...options.managedOverrides,
    }),
  ]

  const invoke = vi.fn(async ({ id, payload }: { id: string; payload: unknown }) => {
    switch (id) {
      case 'endpoint.overview.list':
        await options.overviewGate
        if (options.overviewError) {
          throw options.overviewError
        }
        return { endpoints: [...overviews] }
      case 'endpoint.sshConfigHosts':
        return options.sshConfigHosts ?? []
      case 'endpoint.registerManagedSsh': {
        const input = payload as {
          displayName?: string | null
          host: string
          port?: number | null
          username?: string | null
          remotePort?: number | null
        }
        const overview = createOverview({
          endpoint: {
            endpointId: 'managed-2',
            kind: 'remote_worker',
            displayName: input.displayName?.trim() || 'Managed SSH',
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            access: {
              kind: 'managed_ssh',
              managedSsh: {
                host: input.host,
                port: input.port ?? 22,
                username: input.username ?? null,
                remotePort: input.remotePort ?? 39291,
                remotePlatform: 'auto',
              },
            },
            remote: null,
          },
          status: 'disconnected',
          recommendedAction: 'connect',
          isManaged: true,
        })
        overviews.push(overview)
        return { endpoint: overview.endpoint }
      }
      case 'endpoint.register': {
        const input = payload as {
          displayName?: string | null
          hostname: string
          port: number
        }
        const overview = createOverview({
          endpoint: {
            endpointId: 'manual-1',
            kind: 'remote_worker',
            displayName: input.displayName?.trim() || 'Manual Worker',
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            access: {
              kind: 'manual',
              managedSsh: null,
            },
            remote: {
              hostname: input.hostname,
              port: input.port,
            },
          },
          status: 'disconnected',
          recommendedAction: 'connect',
        })
        overviews.push(overview)
        return { endpoint: overview.endpoint }
      }
      case 'endpoint.updateManagedSsh': {
        const input = payload as {
          endpointId: string
          displayName?: string | null
          host: string
          port?: number | null
          username?: string | null
          remotePort: number
        }
        const overview = overviews.find(
          candidate => candidate.endpoint.endpointId === input.endpointId,
        )
        if (!overview || overview.endpoint.access?.kind !== 'managed_ssh') {
          throw new Error(`Unknown managed endpoint: ${input.endpointId}`)
        }
        overview.endpoint = {
          ...overview.endpoint,
          displayName: input.displayName?.trim() || input.host,
          access: {
            kind: 'managed_ssh',
            managedSsh: {
              host: input.host,
              port: input.port ?? null,
              username: input.username ?? null,
              remotePort: input.remotePort,
              remotePlatform: 'auto',
            },
          },
        }
        return { endpoint: overview.endpoint }
      }
      case 'endpoint.prepare': {
        const { endpointId } = payload as { endpointId: string }
        const matched = overviews.find(overview => overview.endpoint.endpointId === endpointId)
        if (!matched) {
          throw new Error(`Unknown endpointId: ${endpointId}`)
        }

        matched.status = 'connected'
        matched.canBrowse = true
        matched.recommendedAction = 'browse'
        matched.summary = 'Connected.'
        return { overview: { ...matched } }
      }
      case 'endpoint.repair': {
        const { endpointId, action } = payload as { endpointId: string; action: string }
        const matched = overviews.find(overview => overview.endpoint.endpointId === endpointId)
        if (!matched) {
          throw new Error(`Unknown endpointId: ${endpointId}`)
        }

        if (endpointId === 'local' && action === 'retry') {
          matched.status = 'connected'
          matched.recommendedAction = 'none'
          return { overview: { ...matched } }
        }

        throw new Error(`Unexpected repair: ${endpointId}/${action}`)
      }
      case 'endpoint.remove':
        overviews.splice(
          overviews.findIndex(
            overview =>
              overview.endpoint.endpointId === (payload as { endpointId: string }).endpointId,
          ),
          1,
        )
        return null
      default:
        throw new Error(`Unexpected invoke id: ${id}`)
    }
  })

  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      controlSurface: {
        invoke,
      },
    },
  })

  return { invoke }
}
