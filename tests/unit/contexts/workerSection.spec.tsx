import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    render(<WorkerSection remoteWorkersEnabled={false} />)

    const startButton = await screen.findByTestId('settings-worker-local-start')
    expect(startButton).toBeEnabled()

    fireEvent.click(startButton)

    expect(workerStart).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('Enable Local Worker and restart before starting it.')).toBeVisible()
    })
  })

  it('shows local home worker as fixed in packaged builds', async () => {
    installWorkerApi('local', { isPackaged: true })

    render(<WorkerSection remoteWorkersEnabled={false} />)

    expect(await screen.findByText('In Use')).toBeVisible()
    expect(await screen.findByTestId('settings-worker-home-mode-value')).toHaveTextContent(
      'Worker on this device',
    )
    expect(screen.queryByTestId('settings-worker-home-mode-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-worker-apply-restart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-worker-remote-hostname')).not.toBeInTheDocument()
  })
})
