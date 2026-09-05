import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import React from 'react'
import { fireEvent, render as renderUi, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { EndpointsSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/EndpointsSection'
import { installEndpointsApi } from './endpointsSection.testUtils'

describe('EndpointsSection SSH config picker', () => {
  afterEach(async () => {
    await applyUiLanguage('en')
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('queries hosts and prefills the managed form without submitting', async () => {
    const { invoke } = installEndpointsApi({
      sshConfigHosts: [
        { alias: 'build-box', hostName: '10.0.0.8', user: 'deploy', port: 2202 },
        { alias: 'Build-Box', hostName: 'duplicate.example.com', user: null, port: null },
        { alias: 'EXAMPLE.COM', hostName: null, user: null, port: null },
      ],
    })

    render(<EndpointsSection />)

    await screen.findByText('Remote machines')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.click(screen.getByTestId('settings-endpoints-ssh-config-open'))

    expect(await screen.findByText('build-box')).toBeVisible()
    expect(screen.getAllByText(/build-box/i)).toHaveLength(1)
    expect(screen.getByText('deploy@10.0.0.8')).toBeVisible()
    expect(screen.getByTestId('settings-endpoints-ssh-config-host-EXAMPLE.COM')).toBeDisabled()
    expect(screen.getByText('Already added')).toBeVisible()
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'endpoint.sshConfigHosts',
      payload: null,
    })

    fireEvent.click(screen.getByTestId('settings-endpoints-ssh-config-host-build-box'))

    expect(screen.getByTestId('settings-endpoints-register-displayName')).toHaveValue('build-box')
    expect(screen.getByTestId('settings-endpoints-register-hostname')).toHaveValue('build-box')
    expect(screen.getByTestId('settings-endpoints-register-username')).toHaveValue('')
    expect(screen.getByTestId('settings-endpoints-register-ssh-port')).toHaveValue('')
    expect(screen.getByTestId('settings-endpoints-register-remote-port')).toHaveValue('')
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'endpoint.registerManagedSsh' }),
    )
  })

  it.each([
    ['en', 'No importable hosts'],
    ['zh-CN', '无可导入主机'],
  ] as const)('shows the %s empty state when no hosts can be imported', async (language, text) => {
    await applyUiLanguage(language)
    installEndpointsApi({ sshConfigHosts: [] })

    render(<EndpointsSection />)

    await screen.findByTestId('settings-endpoints-open-register')
    fireEvent.click(screen.getByTestId('settings-endpoints-open-register'))
    fireEvent.click(screen.getByTestId('settings-endpoints-ssh-config-open'))

    expect(await screen.findByText(text)).toBeVisible()
  })

  it('keeps importing disabled until existing managed hosts have loaded', async () => {
    let releaseOverview: (() => void) | undefined
    const overviewGate = new Promise<void>(resolve => {
      releaseOverview = resolve
    })
    installEndpointsApi({ overviewGate })

    render(<EndpointsSection />)

    fireEvent.click(screen.getByTestId('settings-endpoints-empty-register'))
    expect(screen.getByTestId('settings-endpoints-ssh-config-open')).toBeDisabled()

    releaseOverview?.()
    await waitFor(() => {
      expect(screen.getByTestId('settings-endpoints-ssh-config-open')).toBeEnabled()
    })
  })

  it('keeps importing disabled when existing managed hosts fail to load', async () => {
    installEndpointsApi({ overviewError: new Error('overview unavailable') })

    render(<EndpointsSection />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-endpoints-refresh')).toBeEnabled()
    })
    fireEvent.click(screen.getByTestId('settings-endpoints-empty-register'))
    expect(screen.getByTestId('settings-endpoints-ssh-config-open')).toBeDisabled()
  })
})

function render(ui: React.ReactNode) {
  return renderUi(ui, { wrapper: EndpointOverviewProvider })
}
