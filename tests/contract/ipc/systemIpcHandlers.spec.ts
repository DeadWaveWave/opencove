import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
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
      dialog: { showSaveDialog: vi.fn() },
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
      dialog: { showSaveDialog: vi.fn() },
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

  it('opens a save dialog in Downloads and writes the selected path', async () => {
    const mkdir = vi.fn()
    const writeFile = vi.fn().mockResolvedValueOnce(undefined)
    const { handlers, ipcMain } = createIpcHarness()
    const selectedPath = path.join('/tmp/opencove-downloads', 'chosen.md')
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: selectedPath }))

    vi.doMock('node:child_process', () => ({
      execFile: vi.fn(),
      default: { execFile: vi.fn() },
    }))
    vi.doMock('node:fs/promises', () => ({ default: { mkdir, writeFile }, mkdir, writeFile }))
    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-downloads') },
      BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
      dialog: { showSaveDialog },
      Notification: { isSupported: vi.fn(() => false) },
      ipcMain,
    }))

    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    registerSystemIpcHandlers()

    const saveHandler = handlers.get(IPC_CHANNELS.systemSaveTextToDownloads)
    await expect(
      invokeHandledIpc(saveHandler, null, {
        fileName: 'note.md',
        content: 'hello',
      }),
    ).resolves.toEqual({
      status: 'saved',
      fileName: 'chosen.md',
      path: selectedPath,
    })

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: path.join('/tmp/opencove-downloads', 'note.md'),
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      }),
    )
    expect(mkdir).toHaveBeenCalledWith('/tmp/opencove-downloads', { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(selectedPath, 'hello', { encoding: 'utf8' })
  })

  it('does not write when the save dialog is canceled', async () => {
    const mkdir = vi.fn()
    const writeFile = vi.fn()
    const { handlers, ipcMain } = createIpcHarness()
    const showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: undefined }))

    vi.doMock('node:child_process', () => ({
      execFile: vi.fn(),
      default: { execFile: vi.fn() },
    }))
    vi.doMock('node:fs/promises', () => ({ default: { mkdir, writeFile }, mkdir, writeFile }))
    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-downloads') },
      BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
      dialog: { showSaveDialog },
      Notification: { isSupported: vi.fn(() => false) },
      ipcMain,
    }))

    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    registerSystemIpcHandlers()

    const saveHandler = handlers.get(IPC_CHANNELS.systemSaveTextToDownloads)
    await expect(
      invokeHandledIpc(saveHandler, null, {
        fileName: 'note.md',
        content: 'hello',
      }),
    ).resolves.toEqual({
      status: 'canceled',
      fileName: 'note.md',
      path: null,
    })

    expect(showSaveDialog).toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rejects unsafe download file names', async () => {
    const { handlers, ipcMain } = createIpcHarness()

    vi.doMock('node:child_process', () => ({
      execFile: vi.fn(),
      default: { execFile: vi.fn() },
    }))
    vi.doMock('node:fs/promises', () => ({
      default: { mkdir: vi.fn(), writeFile: vi.fn() },
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    }))
    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-downloads') },
      BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
      dialog: { showSaveDialog: vi.fn() },
      Notification: { isSupported: vi.fn(() => false) },
      ipcMain,
    }))

    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    registerSystemIpcHandlers()

    const saveHandler = handlers.get(IPC_CHANNELS.systemSaveTextToDownloads)
    await expect(
      invokeHandledIpc(saveHandler, null, {
        fileName: '../note.md',
        content: 'hello',
      }),
    ).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
    await expect(
      invokeHandledIpc(saveHandler, null, {
        fileName: 'con.md',
        content: 'hello',
      }),
    ).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
  })
})
