import { vi } from 'vitest'

export function installSettingsPanelWorkerApi(): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      meta: {
        isPackaged: false,
      },
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
      clipboard: {
        readText: vi.fn(async () => ''),
        writeText: vi.fn(),
      },
    },
  })
}
