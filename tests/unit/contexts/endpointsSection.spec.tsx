import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import React from 'react'
import { fireEvent, render as renderUi, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { EndpointsSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection'
import { createOverview, installEndpointsApi } from './endpointsSection.testUtils'

describe('EndpointsSection', () => {
  afterEach(async () => {
    await applyUiLanguage('en')
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('shows a persistent topology save failure with a retry action', async () => {
    const { invoke } = installEndpointsApi({
      localOverview: createOverview({
        status: 'persistence_failed',
        recommendedAction: 'retry',
      }),
    })

    render(<EndpointsSection />)

    expect(await screen.findByText(/The last topology change was not saved\./)).toBeVisible()
    fireEvent.click(screen.getByTestId('settings-topology-persistence-recommended-action'))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'endpoint.repair',
          payload: { endpointId: 'local', action: 'retry', runtimeBuild: null },
        }),
      )
    })
  })

  it('opens registration in a dialog instead of rendering the form inline', async () => {
    installEndpointsApi()

    render(<EndpointsSection />)

    expect(await screen.findAllByText('Remote machines')).toHaveLength(1)
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))

    expect(screen.getByTestId('settings-endpoints-register-window')).toBeVisible()
    expect(screen.getByTestId('settings-endpoints-register-hostname')).toBeVisible()
  })

  it('registers a managed SSH endpoint from the default mode', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote machines')
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

  it.each(['abc', '0', '70000', '2 2'])('rejects illegal managed SSH port %j', async port => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote machines')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    fireEvent.change(screen.getByTestId('settings-endpoints-register-ssh-port'), {
      target: { value: port },
    })

    expect(screen.getByTestId('settings-endpoints-register-ssh-port-error')).toHaveTextContent(
      'Enter a whole-number port from 1 to 65535.',
    )
    expect(screen.getByTestId('settings-endpoints-register-submit')).toBeDisabled()
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'endpoint.registerManagedSsh' }),
    )
  })

  it('can switch to manual mode and register a manual endpoint', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)

    await screen.findByText('Remote machines')
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

  it('edits a managed SSH endpoint with the reused dialog', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)
    await screen.findAllByText('SSH Box')
    fireEvent.click(screen.getByTestId('settings-endpoints-edit-managed-1'))

    expect(screen.getByTestId('settings-endpoints-register-window')).toHaveTextContent(
      'Edit remote machine',
    )
    expect(screen.queryByTestId('settings-endpoints-register-mode')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-endpoints-register-ssh-port')).toHaveValue('22')
    fireEvent.change(screen.getByTestId('settings-endpoints-register-ssh-port'), {
      target: { value: '2222' },
    })
    fireEvent.click(screen.getByTestId('settings-endpoints-register-submit'))

    await waitFor(() => {
      expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Over SSH · ubuntu@example.com:2222')).toBeVisible()
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.updateManagedSsh',
        payload: expect.objectContaining({ endpointId: 'managed-1', port: 2222 }),
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

  it('confirms removal with the dependent mount count and supports cancel', async () => {
    const { invoke } = installEndpointsApi()

    render(<EndpointsSection />)
    await screen.findAllByText('SSH Box')

    fireEvent.click(screen.getByTestId('settings-endpoints-remove-managed-1'))
    expect(screen.getByTestId('settings-endpoints-remove-window')).toBeVisible()
    expect(screen.getByTestId('settings-endpoints-remove-impact')).toHaveTextContent(
      'This will unbind 2 mounts from the remote machine.',
    )

    fireEvent.click(screen.getByTestId('settings-endpoints-remove-cancel'))
    expect(screen.queryByTestId('settings-endpoints-remove-window')).not.toBeInTheDocument()
    expect(screen.getAllByText('SSH Box').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('settings-endpoints-remove-managed-1'))
    fireEvent.click(screen.getByTestId('settings-endpoints-remove-confirm'))

    await waitFor(() => {
      expect(screen.queryByText('SSH Box')).not.toBeInTheDocument()
    })
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'endpoint.remove',
        payload: { endpointId: 'managed-1', expectedMountCount: 2 },
      }),
    )
  })

  it('shows corrupt runtime diagnostics with the existing repair action', async () => {
    installEndpointsApi({
      managedOverrides: {
        status: 'runtime_corrupt',
        summary: 'Remote runtime is corrupt.',
        details: ['dyld: Library not loaded: Electron Framework'],
        recommendedAction: 'install_runtime',
      },
    })

    render(<EndpointsSection />)

    expect(await screen.findByText('Remote components damaged')).toBeVisible()
    expect(
      screen.getByText(
        'The remote components cannot run. Reinstall them before trying to reconnect.',
      ),
    ).toBeVisible()
    expect(screen.getByText('dyld: Library not loaded: Electron Framework')).toBeVisible()
    expect(screen.getByText('Install remote components')).toBeVisible()
  })

  it('localizes corrupt runtime diagnosis and repair action in Chinese', async () => {
    await applyUiLanguage('zh-CN')
    installEndpointsApi({
      managedOverrides: {
        status: 'runtime_corrupt',
        summary: 'Remote runtime is corrupt.',
        details: ['dyld: Library not loaded: Electron Framework'],
        recommendedAction: 'install_runtime',
      },
    })

    render(<EndpointsSection />)

    expect(await screen.findByText('远程组件已损坏')).toBeVisible()
    expect(screen.getByText('远程组件无法运行。请重新安装后再尝试连接。')).toBeVisible()
    expect(screen.getByText('安装远程组件')).toBeVisible()
  })

  it('protects only drafts changed from their opening baseline', async () => {
    installEndpointsApi()
    render(<EndpointsSection />)
    await screen.findByText('Remote machines')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.pointerDown(screen.getByTestId('settings-endpoints-register-backdrop'))
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.change(screen.getByTestId('settings-endpoints-register-hostname'), {
      target: { value: 'build.example.com' },
    })
    fireEvent.pointerDown(screen.getByTestId('settings-endpoints-register-backdrop'))
    expect(screen.getByTestId('settings-endpoints-register-window')).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('settings-endpoints-register-window')).not.toBeInTheDocument()
  })
})

function render(ui: React.ReactNode) {
  return renderUi(ui, { wrapper: EndpointOverviewProvider })
}
