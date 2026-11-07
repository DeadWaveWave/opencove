import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppError } from '@shared/errors/appError'
import { applyUiLanguage } from '@app/renderer/i18n'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'
import { en } from '../../../src/app/renderer/i18n/locales/en'
import { zhCN } from '../../../src/app/renderer/i18n/locales/zh-CN'

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
  afterEach(async () => {
    await applyUiLanguage('en')
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it.each([
    ['en', 'worker.stop_not_owned', en.common.workerStopNotOwned],
    ['zh-CN', 'worker.stop_not_owned', zhCN.common.workerStopNotOwned],
    ['en', 'worker.external_owner_unreachable', en.common.workerExternalOwnerUnreachable],
    ['zh-CN', 'worker.external_owner_unreachable', zhCN.common.workerExternalOwnerUnreachable],
  ] as const)('shows %s text for %s', async (language, code, message) => {
    await applyUiLanguage(language)
    installWorkerApi('local')
    vi.mocked(window.opencoveApi.worker.getStatus).mockResolvedValue({
      status: 'running',
      connection: {
        version: 1,
        pid: 12345,
        hostname: '127.0.0.1',
        port: 4321,
        token: 'test',
        createdAt: 'test',
        appVersion: 'test',
        startedBy: 'cli',
      },
    })
    vi.mocked(window.opencoveApi.worker.stop).mockRejectedValue(
      language === 'en' ? createAppError(code) : { code },
    )
    render(<WorkerSection />)
    const button = await screen.findByTestId('settings-worker-local-stop')
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(await screen.findByText(message)).toBeVisible()
    expect(window.opencoveApi.worker.stop).toHaveBeenCalledTimes(1)
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
