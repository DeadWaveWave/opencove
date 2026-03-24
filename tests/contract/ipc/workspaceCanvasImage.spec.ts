import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

const userDataDir = '/tmp/opencove-user-data'

function createValidAssetId(): string {
  return '5b7f2a2e-7c2f-4d2a-8e8b-2c3a9b7a6f10'
}

async function setupIpc(): Promise<{
  handlers: Map<string, (...args: unknown[]) => unknown>
  ipcMain: {
    handle: ReturnType<typeof vi.fn>
    removeHandler: ReturnType<typeof vi.fn>
  }
  fsMocks: {
    mkdir: ReturnType<typeof vi.fn>
    writeFile: ReturnType<typeof vi.fn>
    rename: ReturnType<typeof vi.fn>
    rm: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
  }
  disposable: { dispose: () => void }
}> {
  vi.resetModules()

  const mkdir = vi.fn(async () => undefined)
  const writeFile = vi.fn(async () => undefined)
  const rename = vi.fn(async () => undefined)
  const rm = vi.fn(async () => undefined)
  const readFile = vi.fn(async () => Buffer.from([1, 2, 3]))

  vi.doMock('node:fs/promises', () => ({
    mkdir,
    writeFile,
    rename,
    rm,
    readFile,
    default: { mkdir, writeFile, rename, rm, readFile },
  }))

  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  const app = {
    getPath: vi.fn(() => userDataDir),
  }

  const clipboard = {
    writeText: vi.fn(),
  }

  const dialog = {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  }

  vi.doMock('electron', () => ({ ipcMain, app, clipboard, dialog }))

  const approvedStore = {
    registerRoot: vi.fn(async () => undefined),
    isPathApproved: vi.fn(async () => true),
  }

  const { registerWorkspaceIpcHandlers } =
    await import('../../../src/contexts/workspace/presentation/main-ipc/register')

  return {
    handlers,
    ipcMain,
    fsMocks: { mkdir, writeFile, rename, rm, readFile },
    disposable: registerWorkspaceIpcHandlers(approvedStore),
  }
}

describe('workspace canvas image IPC', () => {
  it('writes canvas images to the userData canvas-images store', async () => {
    const { handlers, fsMocks, disposable } = await setupIpc()

    const assetId = createValidAssetId()
    const bytes = new Uint8Array([1, 2, 3])

    const writeHandler = handlers.get(IPC_CHANNELS.workspaceWriteCanvasImage)
    expect(writeHandler).toBeTypeOf('function')

    await expect(
      invokeHandledIpc(writeHandler, null, {
        assetId,
        bytes,
        mimeType: 'image/png',
        fileName: 'hello.png',
      }),
    ).resolves.toBeUndefined()

    expect(fsMocks.mkdir).toHaveBeenCalledWith(resolve(userDataDir, 'canvas-images'), {
      recursive: true,
    })

    const writePath = fsMocks.writeFile.mock.calls[0]?.[0] as string | undefined
    expect(writePath).toContain(resolve(userDataDir, 'canvas-images', `${assetId}.tmp-`))

    expect(fsMocks.rename).toHaveBeenCalledWith(
      writePath,
      resolve(userDataDir, 'canvas-images', assetId),
    )
    expect(fsMocks.rm).toHaveBeenCalledWith(writePath, { force: true })

    disposable.dispose()
  })

  it('returns null when reading a missing canvas image asset', async () => {
    const { handlers, fsMocks, disposable } = await setupIpc()

    fsMocks.readFile.mockImplementationOnce(async () => {
      const error = new Error('missing') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    const readHandler = handlers.get(IPC_CHANNELS.workspaceReadCanvasImage)
    expect(readHandler).toBeTypeOf('function')

    await expect(
      invokeHandledIpc(readHandler, null, { assetId: createValidAssetId() }),
    ).resolves.toBeNull()

    disposable.dispose()
  })

  it('deletes canvas image assets with force: true', async () => {
    const { handlers, fsMocks, disposable } = await setupIpc()

    const assetId = createValidAssetId()
    const deleteHandler = handlers.get(IPC_CHANNELS.workspaceDeleteCanvasImage)
    expect(deleteHandler).toBeTypeOf('function')

    await expect(invokeHandledIpc(deleteHandler, null, { assetId })).resolves.toBeUndefined()

    expect(fsMocks.rm).toHaveBeenCalledWith(resolve(userDataDir, 'canvas-images', assetId), {
      force: true,
    })

    disposable.dispose()
  })
})
