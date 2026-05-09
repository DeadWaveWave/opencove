import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener)
    }),
    removeListener: vi.fn((channel: string) => {
      listeners.delete(channel)
    }),
  }

  return { handlers, ipcMain }
}

describe('performance diagnostics IPC handlers', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns a typed performance diagnostics snapshot', async () => {
    const snapshot = {
      capturedAt: '2026-05-07T00:00:00.000Z',
      platform: 'win32',
      arch: 'x64',
      mainPid: 100,
      processTree: {
        status: 'available' as const,
        rootPid: 100,
        sampledProcessCount: 1,
        message: null,
      },
      processes: [],
      processSummary: [],
      electronMetrics: [],
      notes: [],
    }
    const collectPerformanceDiagnosticsSnapshot = vi.fn(async () => snapshot)
    const { handlers, ipcMain } = createIpcHarness()

    vi.doMock('electron', () => ({ ipcMain }))
    vi.doMock('../../../src/app/main/diagnostics/performanceDiagnosticsCollector', () => ({
      collectPerformanceDiagnosticsSnapshot,
    }))

    const { registerDiagnosticsIpcHandlers } =
      await import('../../../src/app/main/ipc/registerDiagnosticsIpcHandlers')
    const disposable = registerDiagnosticsIpcHandlers()

    const handler = handlers.get(IPC_CHANNELS.performanceDiagnosticsSnapshot)
    await expect(invokeHandledIpc(handler, null, undefined)).resolves.toEqual(snapshot)

    disposable.dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.performanceDiagnosticsSnapshot)
  })

  it('rejects unexpected payloads', async () => {
    const { handlers, ipcMain } = createIpcHarness()

    vi.doMock('electron', () => ({ ipcMain }))
    vi.doMock('../../../src/app/main/diagnostics/performanceDiagnosticsCollector', () => ({
      collectPerformanceDiagnosticsSnapshot: vi.fn(),
    }))

    const { registerDiagnosticsIpcHandlers } =
      await import('../../../src/app/main/ipc/registerDiagnosticsIpcHandlers')
    registerDiagnosticsIpcHandlers()

    const handler = handlers.get(IPC_CHANNELS.performanceDiagnosticsSnapshot)
    await expect(invokeHandledIpc(handler, null, { unexpected: true })).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
  })
})
