import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { PersistWriteResult } from '../../../src/shared/types/api'

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

describe('persistence IPC handlers', () => {
  it('reads persisted raw workspace state through the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => '{"formatVersion":1}'),
      writeWorkspaceStateRaw: vi.fn(
        async (_raw: string): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(
        async (_state: unknown): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const readHandler = handlers.get(IPC_CHANNELS.persistenceReadWorkspaceStateRaw)
    expect(readHandler).toBeTypeOf('function')

    await expect(readHandler?.()).resolves.toBe('{"formatVersion":1}')
    expect(store.readWorkspaceStateRaw).toHaveBeenCalledTimes(1)
  })

  it('writes persisted raw workspace state through the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 12 }

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(async (_raw: string) => writeResult),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(async (_state: unknown) => writeResult),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null) => writeResult,
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const writeHandler = handlers.get(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw)
    expect(writeHandler).toBeTypeOf('function')

    const raw = JSON.stringify({ formatVersion: 1, activeWorkspaceId: null, workspaces: [] })

    await expect(writeHandler?.(null, { raw })).resolves.toEqual(writeResult)
    expect(store.writeWorkspaceStateRaw).toHaveBeenCalledWith(raw)
  })

  it('rejects invalid payloads without calling the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(
        async (_raw: string): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(
        async (_state: unknown): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const writeHandler = handlers.get(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw)
    expect(writeHandler).toBeTypeOf('function')

    const result = (await writeHandler?.(null, { raw: '{not-json' })) as PersistWriteResult

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unknown')
    }

    expect(store.writeWorkspaceStateRaw).not.toHaveBeenCalled()
  })

  it('enforces the raw payload max bytes', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(
        async (_raw: string): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(
        async (_state: unknown): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store, { maxRawBytes: 10 })

    const writeHandler = handlers.get(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw)
    expect(writeHandler).toBeTypeOf('function')

    const raw = JSON.stringify({ formatVersion: 1, activeWorkspaceId: null, workspaces: [] })
    expect(raw.length).toBeGreaterThan(10)

    await expect(writeHandler?.(null, { raw })).resolves.toEqual({
      ok: false,
      reason: 'payload_too_large',
      message: expect.stringContaining('too large'),
    })

    expect(store.writeWorkspaceStateRaw).not.toHaveBeenCalled()
  })

  it('removes IPC handlers on dispose', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(
        async (_raw: string): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(
        async (_state: unknown): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    const disposable = registerPersistenceIpcHandlers(async () => store)

    disposable.dispose()

    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.persistenceReadWorkspaceStateRaw,
    )
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      IPC_CHANNELS.persistenceWriteWorkspaceStateRaw,
    )
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.persistenceReadAppState)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.persistenceWriteAppState)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.persistenceReadNodeScrollback)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.persistenceWriteNodeScrollback)
    expect(handlers.size).toBe(0)
  })

  it('reads persisted app state through the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: {},
    }

    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(
        async (_raw: string): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readAppState: vi.fn(async () => state),
      writeAppState: vi.fn(
        async (_nextState: unknown): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null): Promise<PersistWriteResult> => ({
          ok: true,
          level: 'full',
          bytes: 0,
        }),
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const handler = handlers.get(IPC_CHANNELS.persistenceReadAppState)
    expect(handler).toBeTypeOf('function')

    await expect(handler?.()).resolves.toEqual({ state, recovery: null })
    expect(store.readAppState).toHaveBeenCalledTimes(1)
  })

  it('writes persisted app state through the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 12 }
    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(async (_raw: string) => writeResult),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(async (_state: unknown) => writeResult),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null) => writeResult,
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const handler = handlers.get(IPC_CHANNELS.persistenceWriteAppState)
    expect(handler).toBeTypeOf('function')

    const state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: {},
    }

    await expect(handler?.(null, { state })).resolves.toEqual(writeResult)
    expect(store.writeAppState).toHaveBeenCalledWith(state)
  })

  it('writes node scrollback through the store', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 12 }
    const store = {
      readWorkspaceStateRaw: vi.fn(async () => null),
      writeWorkspaceStateRaw: vi.fn(async (_raw: string) => writeResult),
      readAppState: vi.fn(async () => null),
      writeAppState: vi.fn(async (_state: unknown) => writeResult),
      readNodeScrollback: vi.fn(async (_nodeId: string) => null),
      writeNodeScrollback: vi.fn(
        async (_nodeId: string, _scrollback: string | null) => writeResult,
      ),
      consumeRecovery: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')

    registerPersistenceIpcHandlers(async () => store)

    const handler = handlers.get(IPC_CHANNELS.persistenceWriteNodeScrollback)
    expect(handler).toBeTypeOf('function')

    await expect(handler?.(null, { nodeId: 'node-1', scrollback: 'hello' })).resolves.toEqual(
      writeResult,
    )
    expect(store.writeNodeScrollback).toHaveBeenCalledWith('node-1', 'hello')
  })
})
