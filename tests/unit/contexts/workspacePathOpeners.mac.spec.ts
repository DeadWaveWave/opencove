import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import {
  createIpcMainMock,
  createSpawnMock,
  restorePlatform,
} from '../../support/workspacePathOpeners.testUtils'

describe('workspace path openers IPC on macOS', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    restorePlatform(originalPlatform)
  })

  it('lists installed openers and opens paths with resolved aliases', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })

    const installedApplications = new Set(['Visual Studio Code', 'Cursor', 'PyCharm CE'])
    const execFile = vi.fn(
      (
        file: string,
        args: string[],
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        if (file !== 'open') {
          callback(new Error(`Unexpected command: ${file}`))
          return
        }

        if (args[0] === '-Ra') {
          const application = args[1]
          if (installedApplications.has(application)) {
            callback(null, '', '')
            return
          }

          callback(new Error(`Application not found: ${application}`))
          return
        }

        callback(null, '', '')
      },
    )

    const spawn = createSpawnMock()
    const { handlers, ipcMain } = createIpcMainMock()
    const shellOpenPath = vi.fn(async () => '')

    vi.doMock('node:child_process', () => ({ execFile, spawn, default: { execFile, spawn } }))
    vi.doMock('electron', () => ({
      ipcMain,
      clipboard: { writeText: vi.fn() },
      dialog: { showOpenDialog: vi.fn() },
      shell: { openPath: shellOpenPath },
    }))

    const store = {
      registerRoot: vi.fn(async () => undefined),
      isPathApproved: vi.fn(async () => true),
    }

    const { registerWorkspaceIpcHandlers } =
      await import('../../../src/contexts/workspace/presentation/main-ipc/register')

    registerWorkspaceIpcHandlers(store)

    const listHandler = handlers.get(IPC_CHANNELS.workspaceListPathOpeners)
    const openHandler = handlers.get(IPC_CHANNELS.workspaceOpenPath)
    expect(listHandler).toBeTypeOf('function')
    expect(openHandler).toBeTypeOf('function')

    expect(await listHandler?.()).toEqual({
      openers: [
        { id: 'finder', label: 'Finder' },
        { id: 'vscode', label: 'VS Code' },
        { id: 'cursor', label: 'Cursor' },
        { id: 'pycharm', label: 'PyCharm' },
      ],
    })

    const targetPath = '/tmp/cove-approved-workspace/project'
    await expect(
      openHandler?.(null, { path: targetPath, openerId: 'pycharm' }),
    ).resolves.toBeUndefined()

    expect(store.isPathApproved).toHaveBeenCalledWith(targetPath)
    expect(shellOpenPath).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(
      execFile.mock.calls.some(
        ([file, args]) =>
          file === 'open' &&
          Array.isArray(args) &&
          args[0] === '-a' &&
          args[1] === 'PyCharm CE' &&
          args[2] === targetPath,
      ),
    ).toBe(true)
  })
})
