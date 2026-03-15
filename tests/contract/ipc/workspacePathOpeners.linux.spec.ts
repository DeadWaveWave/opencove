import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import {
  createIpcMainMock,
  createSpawnMock,
  restorePlatform,
} from '../../support/workspacePathOpeners.testUtils'
import { invokeHandledIpc } from './ipcTestUtils'

describe('workspace path openers IPC on Linux', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    restorePlatform(originalPlatform)
  })

  it('lists available openers and launches the resolved terminal command', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })

    const availableCommands = new Set(['xdg-terminal-exec', 'code'])
    const execFile = vi.fn(
      (
        file: string,
        args: string[],
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        if (file !== 'which') {
          callback(new Error(`Unexpected command: ${file}`))
          return
        }

        const command = args[0]
        if (availableCommands.has(command)) {
          callback(null, `/usr/bin/${command}`, '')
          return
        }

        callback(new Error(`Command not found: ${command}`))
      },
    )

    const spawn = createSpawnMock()
    const { handlers, ipcMain } = createIpcMainMock()

    vi.doMock('node:child_process', () => ({ execFile, spawn, default: { execFile, spawn } }))
    vi.doMock('electron', () => ({
      ipcMain,
      clipboard: { writeText: vi.fn() },
      dialog: { showOpenDialog: vi.fn() },
      shell: { openPath: vi.fn(async () => '') },
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

    expect(await invokeHandledIpc(listHandler)).toEqual({
      openers: [
        { id: 'finder', label: 'File Manager' },
        { id: 'terminal', label: 'Terminal' },
        { id: 'vscode', label: 'VS Code' },
      ],
    })

    const targetPath = '/home/deadwave/project'
    await expect(
      invokeHandledIpc(openHandler, null, { path: targetPath, openerId: 'terminal' }),
    ).resolves.toBeUndefined()

    expect(spawn).toHaveBeenCalledWith(
      'xdg-terminal-exec',
      [`--dir=${targetPath}`],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
    )
  })
})
