import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EndpointsSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection'
import type { WorkerEndpointDto } from '../../../src/shared/contracts/dto'

function createEndpoint(overrides: Partial<WorkerEndpointDto>): WorkerEndpointDto {
  return {
    endpointId: 'local',
    kind: 'local',
    displayName: 'Local',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    remote: null,
    ...overrides,
  }
}

function installEndpointsApi() {
  const endpoints: WorkerEndpointDto[] = [
    createEndpoint({
      endpointId: 'local',
      kind: 'local',
      displayName: 'Local',
    }),
  ]

  const invoke = vi.fn(async ({ id, payload }: { id: string; payload: unknown }) => {
    switch (id) {
      case 'endpoint.list':
        return { endpoints: [...endpoints] }
      case 'endpoint.register': {
        const input = payload as {
          displayName?: string | null
          hostname: string
          port: number
        }
        const endpoint = createEndpoint({
          endpointId: 'remote-1',
          kind: 'remote_worker',
          displayName: input.displayName?.trim() || 'Remote Worker',
          remote: {
            hostname: input.hostname,
            port: input.port,
          },
        })
        endpoints.push(endpoint)
        return { endpoint }
      }
      case 'endpoint.ping':
        return {
          ok: true,
          endpointId: 'local',
          now: '2026-04-15T00:00:00.000Z',
          pid: 123,
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

    await screen.findByText('Registered endpoints')
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-endpoints-register-hostname')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))

    expect(screen.getByTestId('settings-endpoints-register-window')).toBeVisible()
    expect(screen.getByTestId('settings-endpoints-register-hostname')).toBeVisible()
  })

  it('registers an endpoint from the dialog and closes it on success', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Registered endpoints')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))

    fireEvent.change(screen.getByTestId('settings-endpoints-register-displayName'), {
      target: { value: 'localremote' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
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
      expect(screen.getByText('localremote')).toBeVisible()
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.register',
      }),
    )
  })
})
