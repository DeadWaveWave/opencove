import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  return { handlers, ipcMain }
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('system IPC handlers', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setPlatform(originalPlatform)
  })

  it('falls back to notify-send on Linux when Electron notifications are unavailable', async () => {
    setPlatform('linux')

    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null) => void,
      ) => {
        callback(null)
      },
    )
    const { handlers, ipcMain } = createIpcHarness()
    const Notification = { isSupported: vi.fn(() => false) }

    vi.doMock('node:child_process', () => ({ execFile, default: { execFile } }))
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: vi.fn(() => []) },
      Notification,
      ipcMain,
    }))

    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    registerSystemIpcHandlers()

    const showNotificationHandler = handlers.get(IPC_CHANNELS.systemShowNotification)
    await expect(
      invokeHandledIpc(showNotificationHandler, null, {
        title: 'Agent done',
        body: 'Task complete',
        silent: true,
      }),
    ).resolves.toEqual({ shown: true })

    expect(execFile).toHaveBeenCalledWith(
      'notify-send',
      ['--urgency=low', 'Agent done', 'Task complete'],
      expect.objectContaining({ timeout: 5_000, windowsHide: true }),
      expect.any(Function),
    )
  })

  it('does not use notify-send outside Linux', async () => {
    setPlatform('darwin')

    const execFile = vi.fn()
    const { handlers, ipcMain } = createIpcHarness()
    const Notification = { isSupported: vi.fn(() => false) }

    vi.doMock('node:child_process', () => ({ execFile, default: { execFile } }))
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: vi.fn(() => []) },
      Notification,
      ipcMain,
    }))

    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    registerSystemIpcHandlers()

    const showNotificationHandler = handlers.get(IPC_CHANNELS.systemShowNotification)
    await expect(
      invokeHandledIpc(showNotificationHandler, null, {
        title: 'Agent done',
        body: 'Task complete',
      }),
    ).resolves.toEqual({ shown: false })

    expect(execFile).not.toHaveBeenCalled()
  })
})
