import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddProjectWizardWindow } from '../../../src/app/renderer/shell/components/AddProjectWizardWindow'
import type { WorkerEndpointOverviewDto } from '../../../src/shared/contracts/dto'

function createRemoteOverview(): WorkerEndpointOverviewDto {
  return {
    endpoint: {
      endpointId: 'managed-new',
      kind: 'remote_worker',
      displayName: 'build-box',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      access: {
        kind: 'managed_ssh',
        managedSsh: {
          host: 'build.example.com',
          port: 22,
          username: null,
          remotePort: 39291,
          remotePlatform: 'auto',
        },
      },
      remote: null,
    },
    status: 'connected',
    summary: 'Fresh overview says connected.',
    details: [],
    checkedAt: '2026-08-11T00:00:01.000Z',
    recommendedAction: 'browse',
    isManaged: true,
    canBrowse: true,
    dependentMountCount: 0,
    runtime: {
      appVersion: '0.2.0',
      protocolVersion: 1,
      platform: 'linux',
      pid: 42,
    },
  }
}

describe('AddProjectWizardWindow', () => {
  const selectDirectory = vi.fn()
  const invoke = vi.fn()

  beforeEach(() => {
    selectDirectory.mockReset()
    invoke.mockReset()
    invoke.mockResolvedValue({ endpoints: [] })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        meta: { runtime: 'electron' },
        workerClient: {
          getConfig: vi.fn(async () => ({ mode: 'standalone' })),
        },
        workspace: { selectDirectory },
        controlSurface: {
          invoke,
        },
      },
    })
  })

  it('opens the native folder picker directly for local-only project creation', async () => {
    selectDirectory.mockResolvedValue(null)
    const onClose = vi.fn()

    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled={false}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(selectDirectory).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('workspace-project-create-window')).not.toBeInTheDocument()
  })

  it('uses a compact anchored source picker for remote-enabled projects', async () => {
    render(
      <AddProjectWizardWindow
        anchor={{ x: 188, y: 72 }}
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
      />,
    )

    const popover = screen.getByTestId('workspace-project-create-window')
    expect(popover).toHaveAttribute('aria-modal', 'false')
    expect(popover).toHaveStyle({ left: '188px', top: '72px' })
    expect(screen.queryByTestId('workspace-project-create-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-project-create-backdrop')).not.toBeInTheDocument()
    expect(selectDirectory).not.toHaveBeenCalled()
  })

  it('keeps wizard input intact when inline endpoint registration is cancelled', async () => {
    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
      />,
    )

    fireEvent.change(screen.getByTestId('workspace-project-create-default-local-root'), {
      target: { value: '/draft/project' },
    })
    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-remote'))
    fireEvent.click(screen.getByTestId('workspace-project-create-open-endpoints'))

    expect(screen.getByTestId('workspace-project-create-window')).toBeInTheDocument()
    expect(screen.getByTestId('settings-endpoints-register-window')).toBeVisible()

    fireEvent.click(screen.getByTestId('settings-endpoints-register-cancel'))
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-project-create-window')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-local'))
    expect(screen.getByTestId('workspace-project-create-default-local-root')).toHaveValue(
      '/draft/project',
    )
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'endpoint.registerManagedSsh' }),
    )
    expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'endpoint.register' }))
  })

  it('closes only the child on Escape and returns focus to its trigger', async () => {
    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-remote'))
    const trigger = screen.getByTestId('workspace-project-create-open-endpoints')
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByTestId('settings-endpoints-register-window')).toContainElement(
        document.activeElement as HTMLElement,
      )
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    const submit = screen.getByTestId('settings-endpoints-register-submit')
    submit.focus()
    fireEvent.keyDown(submit, { key: 'Tab' })
    expect(document.activeElement).toBe(
      screen.getByTestId('settings-endpoints-register-mode-managed'),
    )
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(trigger)
    })
    expect(screen.getByTestId('workspace-project-create-window')).toBeInTheDocument()
  })

  it('re-fetches health and selects a newly registered endpoint without clearing the wizard', async () => {
    const freshOverview = createRemoteOverview()
    let registered = false
    invoke.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'endpoint.overview.list') {
        return { endpoints: registered ? [freshOverview] : [] }
      }
      if (id === 'endpoint.registerManagedSsh') {
        registered = true
        return {
          endpoint: freshOverview.endpoint,
          overview: { ...freshOverview, status: 'disconnected', canBrowse: false },
        }
      }
      throw new Error(`Unexpected command: ${id}`)
    })

    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
      />,
    )

    fireEvent.change(screen.getByTestId('workspace-project-create-default-local-root'), {
      target: { value: '/draft/project' },
    })
    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-remote'))
    fireEvent.click(screen.getByTestId('workspace-project-create-open-endpoints'))
    fireEvent.change(screen.getByTestId('settings-endpoints-register-displayName'), {
      target: { value: 'build-box' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('workspace-project-create-window')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-project-create-default-remote-endpoint')).toHaveValue(
      'managed-new',
    )
    expect(
      screen.getByTestId('workspace-project-create-default-remote-status-panel'),
    ).toHaveTextContent('Connected')

    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-local'))
    expect(screen.getByTestId('workspace-project-create-default-local-root')).toHaveValue(
      '/draft/project',
    )

    const calls = invoke.mock.calls.map(([request]) => (request as { id: string }).id)
    const registerIndex = calls.indexOf('endpoint.registerManagedSsh')
    expect(registerIndex).toBeGreaterThanOrEqual(0)
    expect(calls.slice(registerIndex + 1)).toContain('endpoint.overview.list')
  })

  it('retries only the fresh overview query when registration succeeded before refresh failed', async () => {
    const freshOverview = createRemoteOverview()
    let registered = false
    let queriesAfterRegistration = 0
    invoke.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'endpoint.overview.list') {
        if (!registered) {
          return { endpoints: [] }
        }

        queriesAfterRegistration += 1
        return { endpoints: queriesAfterRegistration >= 3 ? [freshOverview] : [] }
      }
      if (id === 'endpoint.registerManagedSsh') {
        registered = true
        return { endpoint: freshOverview.endpoint }
      }
      throw new Error(`Unexpected command: ${id}`)
    })

    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('workspace-project-create-default-location-remote'))
    fireEvent.click(screen.getByTestId('workspace-project-create-open-endpoints'))
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await screen.findByText(
      'The remote endpoint was added, but its current status could not be refreshed. Try again.',
    )
    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    })
    expect(
      invoke.mock.calls.filter(
        ([request]) => (request as { id: string }).id === 'endpoint.registerManagedSsh',
      ),
    ).toHaveLength(1)
    expect(screen.getByTestId('workspace-project-create-default-remote-endpoint')).toHaveValue(
      'managed-new',
    )
  })
})
