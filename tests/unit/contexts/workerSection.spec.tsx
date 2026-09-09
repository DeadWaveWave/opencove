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
        getStatus: vi.fn().mockResolvedValue({ installed: false, path: null, healthy: false }),
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

  it('explains unavailable local control without changing the session configuration', async () => {
    const { workerStart } = installWorkerApi('standalone')

    render(<WorkerSection />)

    const startButton = await screen.findByTestId('settings-worker-local-start')
    await waitFor(() => expect(startButton).toBeEnabled())

    fireEvent.click(startButton)

    expect(workerStart).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('This session is not using a local Worker.')).toBeVisible()
    })
  })

  it.each([false, true])(
    'hides mode controls without mutating runtime in packaged=%s',
    async isPackaged => {
      installWorkerApi('local', { isPackaged })

      render(<WorkerSection />)

      await waitFor(() => expect(screen.getByTestId('settings-worker-local-start')).toBeEnabled())
      expect(screen.queryByText('Current Mode')).not.toBeInTheDocument()
      expect(screen.queryByText('Worker Mode')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-worker-home-mode-value')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-worker-home-mode-trigger')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-worker-apply-restart')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-worker-remote-hostname')).not.toBeInTheDocument()
      expect(window.opencoveApi.workerClient.setConfig).not.toHaveBeenCalled()
      expect(window.opencoveApi.workerClient.relaunch).not.toHaveBeenCalled()
      expect(window.opencoveApi.worker.start).not.toHaveBeenCalled()
      expect(window.opencoveApi.worker.stop).not.toHaveBeenCalled()
    },
  )
})
