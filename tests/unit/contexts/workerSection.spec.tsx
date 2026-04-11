import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'

function installWorkerApi(
  mode: 'standalone' | 'local' | 'remote',
  options?: { isPackaged?: boolean },
) {
  const workerStart = vi.fn()

  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      meta: {
        isPackaged: options?.isPackaged ?? false,
      },
      workerClient: {
        getConfig: vi.fn().mockResolvedValue({
          version: 1,
          mode,
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
        start: workerStart,
        stop: vi.fn(),
        getWebUiUrl: vi.fn(),
      },
      cli: {
        getStatus: vi.fn().mockResolvedValue({ installed: false, path: null }),
        install: vi.fn(),
        uninstall: vi.fn(),
      },
      clipboard: {
        writeText: vi.fn(),
      },
    },
  })

  return { workerStart }
}

describe('WorkerSection', () => {
  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('shows a restart error instead of silently disabling start', async () => {
    const { workerStart } = installWorkerApi('standalone')

    render(<WorkerSection />)

    const startButton = await screen.findByTestId('settings-worker-local-start')
    expect(startButton).toBeEnabled()

    fireEvent.click(startButton)

    expect(workerStart).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('Enable Local Worker and restart before starting it.')).toBeVisible()
    })
  })

  it('hides standalone mode in packaged builds', async () => {
    installWorkerApi('local', { isPackaged: true })

    render(<WorkerSection />)

    const trigger = await screen.findByTestId('settings-worker-home-mode-trigger')
    fireEvent.click(trigger)

    const menu = await screen.findByTestId('settings-worker-home-mode-menu')
    expect(menu).toBeVisible()
    expect(screen.queryByText('Standalone (No Worker)')).not.toBeInTheDocument()
    expect(within(menu).getByText('Local Worker')).toBeVisible()
    expect(within(menu).getByText('Remote Worker')).toBeVisible()
  })
})
