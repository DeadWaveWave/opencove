import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { PersistWriteResult, ReadAppStateResult } from '../../../src/shared/contracts/dto'
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

function createStore(readAppState: PersistenceStore['readAppState']): PersistenceStore {
  const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 0 }

  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async () => writeResult,
    readAppState,
    readAppStateRevision: async () => 0,
    writeAppState: async () => writeResult,
    readNodeScrollback: async () => null,
    writeNodeScrollback: async () => writeResult,
    readAgentNodePlaceholderScrollback: async () => null,
    writeAgentNodePlaceholderScrollback: async () => writeResult,
    consumeRecovery: vi.fn(() => null),
    dispose: () => undefined,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('persistence app-state read IPC', () => {
  it('keeps a legitimate no-state read successful', async () => {
    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))
    const store = createStore(async () => null)
    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const handler = handlers.get(IPC_CHANNELS.persistenceReadAppState)
    await expect(invokeHandledIpc<ReadAppStateResult>(handler)).resolves.toEqual({
      state: null,
      recovery: null,
    })
  })

  it('rejects an app-state read failure as unavailable', async () => {
    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))
    const store = createStore(async () => {
      throw new Error('SQLITE_IOERR: simulated app state read failure')
    })
    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const handler = handlers.get(IPC_CHANNELS.persistenceReadAppState)
    await expect(invokeHandledIpc<ReadAppStateResult>(handler)).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
    expect(store.consumeRecovery).not.toHaveBeenCalled()
  })
})
