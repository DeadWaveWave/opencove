import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'

function createPersistenceStoreStub() {
  const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 0 }

  return {
    readWorkspaceStateRaw: vi.fn(async () => null),
    writeWorkspaceStateRaw: vi.fn(async (_raw: string) => writeResult),
    readAppState: vi.fn(async () => null),
    writeAppState: vi.fn(async (_state: unknown) => writeResult),
    readNodeScrollback: vi.fn(async (_nodeId: string) => null),
    writeNodeScrollback: vi.fn(async (_nodeId: string, _scrollback: string | null) => writeResult),
    consumeRecovery: vi.fn(() => null),
    dispose: vi.fn(),
  }
}

describe('registerIpcHandlers', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('retries persistence store creation after an initialization failure', async () => {
    const store = createPersistenceStoreStub()
    const createPersistenceStore = vi
      .fn()
      .mockRejectedValueOnce(new Error('database locked'))
      .mockResolvedValueOnce(store)

    let getStore: (() => Promise<typeof store>) | null = null

    const ipcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    }

    const clipboard = {
      readText: vi.fn(() => ''),
      writeText: vi.fn(),
    }

    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-user-data') },
      ipcMain,
      clipboard,
    }))
    vi.doMock('../../../src/contexts/agent/presentation/main-ipc/register', () => ({
      registerAgentIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/register', () => ({
      registerPtyIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/runtime', () => ({
      createPtyRuntime: () => ({}),
    }))
    vi.doMock('../../../src/contexts/task/presentation/main-ipc/register', () => ({
      registerTaskIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/workspace/presentation/main-ipc/register', () => ({
      registerWorkspaceIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/update/presentation/main-ipc/register', () => ({
      registerAppUpdateIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/update/infrastructure/main/AppUpdateService', () => ({
      createAppUpdateService: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/releaseNotes/presentation/main-ipc/register', () => ({
      registerReleaseNotesIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/releaseNotes/infrastructure/main/ReleaseNotesService', () => ({
      createReleaseNotesService: () => ({ getRange: vi.fn(async () => ({ items: [] })) }),
    }))
    vi.doMock('../../../src/contexts/worktree/presentation/main-ipc/register', () => ({
      registerWorktreeIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock(
      '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore',
      () => ({
        createApprovedWorkspaceStore: () => ({ registerRoot: vi.fn(async () => undefined) }),
      }),
    )
    vi.doMock('../../../src/platform/persistence/sqlite/PersistenceStore', () => ({
      createPersistenceStore,
    }))
    vi.doMock('../../../src/platform/persistence/sqlite/ipc/register', () => ({
      registerPersistenceIpcHandlers: (nextGetStore: () => Promise<typeof store>) => {
        getStore = nextGetStore
        return { dispose: vi.fn() }
      },
    }))

    const { registerIpcHandlers } = await import('../../../src/app/main/ipc/registerIpcHandlers')
    const disposable = registerIpcHandlers()

    await expect(getStore?.()).rejects.toThrow('database locked')
    await expect(getStore?.()).resolves.toBe(store)
    expect(createPersistenceStore).toHaveBeenCalledTimes(2)

    disposable.dispose()
    await Promise.resolve()
    expect(store.dispose).toHaveBeenCalledTimes(1)
  })
})
