import { describe, expect, it, vi } from 'vitest'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)

  if (relativePath === '') {
    return true
  }

  if (relativePath === '..') {
    return false
  }

  if (relativePath.startsWith(`..${sep}`)) {
    return false
  }

  if (isAbsolute(relativePath)) {
    return false
  }

  return true
}

describe('workspace ensureDirectory IPC', () => {
  it('only allows creating directories within approved workspace roots', async () => {
    vi.resetModules()

    const mkdir = vi.fn(async () => undefined)
    vi.doMock('node:fs/promises', () => ({ mkdir, default: { mkdir } }))

    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
    }

    const dialog = {
      showOpenDialog: vi.fn(),
    }

    vi.doMock('electron', () => ({ ipcMain, dialog }))

    const approvedRoots = new Set<string>()
    const store = {
      registerRoot: vi.fn(async (rootPath: string) => {
        approvedRoots.add(resolve(rootPath))
      }),
      isPathApproved: vi.fn(async (targetPath: string) => {
        const resolvedTarget = resolve(targetPath)
        for (const root of approvedRoots) {
          if (isPathWithinRoot(root, resolvedTarget)) {
            return true
          }
        }

        return false
      }),
    }

    const previousTestWorkspace = process.env.COVE_TEST_WORKSPACE
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    process.env.COVE_TEST_WORKSPACE = '/tmp/cove-approved-workspace'

    try {
      const { registerWorkspaceIpcHandlers } =
        await import('../../../src/contexts/workspace/presentation/main-ipc/register')

      const disposable = registerWorkspaceIpcHandlers(store)

      const selectHandler = handlers.get(IPC_CHANNELS.workspaceSelectDirectory)
      expect(selectHandler).toBeTypeOf('function')

      const selected = await selectHandler?.()
      expect(selected).toEqual(
        expect.objectContaining({
          path: resolve('/tmp/cove-approved-workspace'),
        }),
      )

      const ensureHandler = handlers.get(IPC_CHANNELS.workspaceEnsureDirectory)
      expect(ensureHandler).toBeTypeOf('function')

      await expect(ensureHandler?.(null, { path: 'relative/path' })).rejects.toThrow(
        /requires an absolute path/,
      )

      await expect(ensureHandler?.(null, { path: '/tmp/outside-approved' })).rejects.toThrow(
        /outside approved workspaces/,
      )
      expect(mkdir).not.toHaveBeenCalled()

      await expect(
        ensureHandler?.(null, { path: '/tmp/cove-approved-workspace/.cove/worktrees/demo' }),
      ).resolves.toBeUndefined()
      expect(mkdir).toHaveBeenCalledWith(
        '/tmp/cove-approved-workspace/.cove/worktrees/demo',
        expect.objectContaining({ recursive: true }),
      )

      disposable.dispose()
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.workspaceSelectDirectory)
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.workspaceEnsureDirectory)
    } finally {
      if (typeof previousTestWorkspace === 'string') {
        process.env.COVE_TEST_WORKSPACE = previousTestWorkspace
      } else {
        delete process.env.COVE_TEST_WORKSPACE
      }

      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })
})
