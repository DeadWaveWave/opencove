import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { invokeHandledIpc } from './ipcTestUtils'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'

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

function createApprovedWorkspaceStoreMock({
  isPathApproved = true,
}: {
  isPathApproved?: boolean
} = {}): ApprovedWorkspaceStore {
  return {
    registerRoot: vi.fn(async () => undefined),
    isPathApproved: vi.fn(async () => isPathApproved),
  }
}

describe('IPC filesystem handlers', () => {
  it('blocks unapproved URIs', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = createApprovedWorkspaceStoreMock({ isPathApproved: false })
    const { registerFilesystemIpcHandlers } =
      await import('../../../src/contexts/filesystem/presentation/main-ipc/register')
    const disposable = registerFilesystemIpcHandlers(store)

    const readHandler = handlers.get(IPC_CHANNELS.filesystemReadFileText)
    expect(readHandler).toBeTypeOf('function')

    const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-fs-ipc-unapproved-'))
    const filePath = join(baseDir, 'blocked.txt')

    await expect(invokeHandledIpc(readHandler, null, { uri: toFileUri(filePath) })).rejects.toThrow(
      /outside approved workspaces/i,
    )

    expect(store.isPathApproved).toHaveBeenCalledWith(filePath)

    disposable.dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.filesystemReadFileText)
  })

  it('reads and writes file content when approved', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-fs-ipc-'))
    const filePath = join(baseDir, 'hello.txt')
    await writeFile(filePath, 'hello', 'utf8')

    const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })
    const { registerFilesystemIpcHandlers } =
      await import('../../../src/contexts/filesystem/presentation/main-ipc/register')
    registerFilesystemIpcHandlers(store)

    const uri = toFileUri(filePath)

    const readHandler = handlers.get(IPC_CHANNELS.filesystemReadFileText)
    const writeHandler = handlers.get(IPC_CHANNELS.filesystemWriteFileText)
    expect(readHandler).toBeTypeOf('function')
    expect(writeHandler).toBeTypeOf('function')

    await expect(invokeHandledIpc(readHandler, null, { uri })).resolves.toEqual({
      content: 'hello',
    })

    await expect(invokeHandledIpc(writeHandler, null, { uri, content: 'next' })).resolves.toBe(
      undefined,
    )

    await expect(readFile(filePath, 'utf8')).resolves.toBe('next')
  })

  it('rejects invalid payloads', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })
    const { registerFilesystemIpcHandlers } =
      await import('../../../src/contexts/filesystem/presentation/main-ipc/register')
    registerFilesystemIpcHandlers(store)

    const readHandler = handlers.get(IPC_CHANNELS.filesystemReadFileText)
    expect(readHandler).toBeTypeOf('function')

    await expect(invokeHandledIpc(readHandler, null, { uri: 123 })).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
  })
})
