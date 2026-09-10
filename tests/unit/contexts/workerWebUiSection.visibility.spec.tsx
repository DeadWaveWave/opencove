import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import type { HomeWorkerConfigDto, WorkerStatusResult } from '../../../src/shared/contracts/dto'
import { ExperimentalWorkerWebUiSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/ExperimentalWorkerWebUiSection'

function installApi(
  options: {
    mode?: HomeWorkerConfigDto['mode']
    enabled?: boolean
    running?: boolean
    connected?: boolean
    active?: boolean
  } = {},
) {
  const config: HomeWorkerConfigDto = {
    version: 1,
    mode: options.mode ?? 'local',
    remote:
      options.mode === 'remote'
        ? { hostname: 'remote.test', port: 4411, token: 'test-remote-token' }
        : null,
    webUi: { enabled: options.enabled ?? true, port: 4318, exposeOnLan: false, passwordSet: false },
    updatedAt: null,
  }
  const running: WorkerStatusResult = {
    status: 'running',
    connection: {
      version: 1,
      pid: 4242,
      hostname: '127.0.0.1',
      port: 4411,
      token: 'test-worker-token',
      createdAt: '2026-09-10T00:00:00.000Z',
      appVersion: 'test',
      startedBy: 'desktop',
    },
  }
  const getStatus = vi
    .fn()
    .mockResolvedValue(
      options.running === false
        ? { status: 'stopped', connection: null }
        : { ...running, connection: options.connected === false ? null : running.connection },
    )
  const getConfigurationSnapshot = vi.fn().mockResolvedValue({
    config,
    webAccess: {
      state: options.active === false ? 'disabled' : 'active',
      generation: 1,
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 4318,
      passwordRequired: false,
      drainingGenerations: [],
    },
  })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      workerClient: {
        getConfigurationSnapshot,
        setWebUiSettings: vi.fn(),
        setWebUiSecurity: vi.fn(),
      },
      worker: { getStatus, start: vi.fn(), stop: vi.fn() },
    },
  })
  return { getStatus, getConfigurationSnapshot, running }
}

describe('Worker Web UI launch visibility', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
  })
  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
  })

  it.each([
    ['stopped', { running: false }, 'Stopped'],
    ['disabled', { enabled: false }, 'Disabled'],
    ['remote session', { mode: 'remote' as const }, 'Requires Local Worker'],
    ['inactive listener', { active: false }, 'Stopped'],
    ['missing connection', { connected: false }, 'Ready'],
  ])(
    'hides launch for %s while retaining status, configuration, and refresh',
    async (_, options, status) => {
      installApi(options)
      render(<ExperimentalWorkerWebUiSection />)

      await waitFor(() =>
        expect(screen.getByTestId('settings-experimental-worker-web-ui-status')).toHaveTextContent(
          status,
        ),
      )
      expect(
        screen.queryByTestId('settings-experimental-worker-web-ui-open'),
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('settings-experimental-worker-web-ui-port')).toBeVisible()
      expect(screen.getByTestId('settings-experimental-worker-web-ui-password')).toBeVisible()
      const refresh = screen.getByRole('button', { name: 'Refresh' })
      expect(refresh).toBeEnabled()
      expect(refresh).toHaveAttribute('title', 'Refresh')
      expect(window.opencoveApi.worker.start).not.toHaveBeenCalled()
      expect(window.opencoveApi.worker.stop).not.toHaveBeenCalled()
      expect(window.opencoveApi.workerClient.setWebUiSettings).not.toHaveBeenCalled()
      expect(window.opencoveApi.workerClient.setWebUiSecurity).not.toHaveBeenCalled()
    },
  )

  it('shows launch only after refresh observes a running Worker and active listener', async () => {
    const { getStatus, getConfigurationSnapshot, running } = installApi({ running: false })
    render(<ExperimentalWorkerWebUiSection />)

    await waitFor(() =>
      expect(screen.getByTestId('settings-experimental-worker-web-ui-status')).toHaveTextContent(
        'Stopped',
      ),
    )
    expect(screen.queryByTestId('settings-experimental-worker-web-ui-open')).not.toBeInTheDocument()
    getStatus.mockResolvedValue(running)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'Open Web UI' })).toBeEnabled()
    expect(screen.getAllByTestId('settings-experimental-worker-web-ui-status')).toHaveLength(1)
    expect(getConfigurationSnapshot).toHaveBeenCalledTimes(2)

    getStatus.mockResolvedValue({ status: 'stopped', connection: null })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open Web UI' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })
})
