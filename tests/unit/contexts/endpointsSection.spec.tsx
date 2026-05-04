import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EndpointsSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection'
import type { WorkerEndpointOverviewDto } from '../../../src/shared/contracts/dto'

function createOverview(overrides: Partial<WorkerEndpointOverviewDto>): WorkerEndpointOverviewDto {
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
    runtime: {
      appVersion: null,
      protocolVersion: null,
      platform: null,
      pid: null,
    },
    ...overrides,
  }
}

function installEndpointsApi() {
  const overviews: WorkerEndpointOverviewDto[] = [
    createOverview({}),
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
    }),
  ]

  const invoke = vi.fn(async ({ id, payload }: { id: string; payload: unknown }) => {
    switch (id) {
      case 'endpoint.overview.list':
        return { endpoints: [...overviews] }
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
      case 'endpoint.remove':
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

describe('EndpointsSection', () => {
  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('opens registration in a dialog instead of rendering the form inline', async () => {
    installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote endpoints')
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))

    expect(screen.getByTestId('settings-endpoints-register-window')).toBeVisible()
    expect(screen.getByTestId('settings-endpoints-register-hostname')).toBeVisible()
  })

  it('registers a managed SSH endpoint from the default mode', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote endpoints')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))

    fireEvent.change(screen.getByTestId('settings-endpoints-register-displayName'), {
      target: { value: 'build-box' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-username'), {
      target: { value: 'ubuntu' },
    })

    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('build-box').length).toBeGreaterThan(0)
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.registerManagedSsh',
      }),
    )
  })

  it('can switch to manual mode and register a manual endpoint', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote endpoints')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.click(screen.getByTestId('settings-endpoints-register-mode-manual'))

    fireEvent.change(screen.getByTestId('settings-endpoints-register-displayName'), {
      target: { value: 'manual-remote' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-manual-hostname'), {
      target: { value: '127.0.0.1' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-port'), {
      target: { value: '52084' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-token'), {
      target: { value: 'token' },
    })

    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('manual-remote').length).toBeGreaterThan(0)
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.register',
      }),
    )
  })

  it('runs the recommended connect action from the endpoint card', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findAllByText('SSH Box')
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => {
      expect(screen.getByText('Ready. You can browse folders or bind a remote path.')).toBeVisible()
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.prepare',
      }),
    )
  })
})
