import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'

function installWorkerApi(): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      meta: { isPackaged: false },
      workerClient: {
        getConfig: vi.fn().mockResolvedValue({
          version: 1,
          mode: 'standalone',
          remote: null,
          webUi: {
            enabled: false,
            port: null,
            exposeOnLan: false,
            passwordSet: false,
          },
          updatedAt: null,
        }),
        setConfig: vi.fn(),
        relaunch: vi.fn(),
      },
      worker: {
        getStatus: vi.fn().mockResolvedValue({ status: 'stopped', connection: null }),
        start: vi.fn(),
        stop: vi.fn(),
        getWebUiUrl: vi.fn(),
      },
      cli: {
        getStatus: vi.fn().mockResolvedValue({ installed: false, path: null, healthy: false }),
        install: vi.fn(),
        uninstall: vi.fn(),
      },
      clipboard: { writeText: vi.fn() },
    },
  })
}

describe('WorkerSection hierarchy', () => {
  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('groups Worker Mode, CLI, and Local Worker controls under named modules', async () => {
    installWorkerApi()

    render(<WorkerSection remoteWorkersEnabled={false} />)

    expect(await screen.findByRole('group', { name: 'Worker Mode' })).toBeVisible()

    const cliModule = screen.getByRole('group', { name: 'CLI' })
    expect(within(cliModule).getByTestId('settings-worker-cli-status')).toBeVisible()
    expect(within(cliModule).getByTestId('settings-worker-cli-install')).toBeVisible()
    expect(within(cliModule).getByTestId('settings-worker-cli-uninstall')).toBeVisible()

    const localWorkerModule = screen.getByRole('group', { name: 'Local Worker' })
    expect(within(localWorkerModule).getByTestId('settings-worker-local-status')).toBeVisible()
    expect(within(localWorkerModule).getByTestId('settings-worker-local-start')).toBeVisible()
    expect(within(localWorkerModule).getByTestId('settings-worker-local-stop')).toBeVisible()
  })
})
