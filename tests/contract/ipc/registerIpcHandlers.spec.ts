import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

async function waitForMockCalls(
  mockFn: { mock: { calls: unknown[] } },
  expectedCalls: number,
  remainingChecks = 50,
): Promise<void> {
  if (mockFn.mock.calls.length >= expectedCalls) {
    return
  }

  if (remainingChecks <= 0) {
    throw new Error(
      `Timed out waiting for ${expectedCalls} calls (got ${mockFn.mock.calls.length}).`,
    )
  }

  await Promise.resolve()
  await waitForMockCalls(mockFn, expectedCalls, remainingChecks - 1)
}

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

function createPersistenceStoreStub() {
  const writeResult: PersistWriteResult = { ok: true, level: 'full', bytes: 0 }

  return {
    readWorkspaceStateRaw: vi.fn(async () => null),
    writeWorkspaceStateRaw: vi.fn(async (_raw: string) => writeResult),
    readAppState: vi.fn(async () => null),
    readAppStateRevision: vi.fn(async () => 0),
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
      createReleaseNotesService: () => ({ getCurrent: vi.fn(async () => ({ items: [] })) }),
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
    await waitForMockCalls(store.dispose, 1)
    expect(store.dispose).toHaveBeenCalledTimes(1)
  })

  it('hydrates persisted workspace roots before local workspace guards run', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    const clipboard = {
      readText: vi.fn(() => ''),
      writeText: vi.fn(),
    }

    let releaseHydration: (() => void) | null = null
    const hydrationBarrier = new Promise<void>(resolve => {
      releaseHydration = resolve
    })

    const approvedRoots = new Set<string>()
    const approvedWorkspaces = {
      registerRoot: vi.fn(async (rootPath: string) => {
        if (rootPath === '/tmp/persisted-workspace') {
          await hydrationBarrier
        }

        approvedRoots.add(rootPath)
      }),
      isPathApproved: vi.fn(async (targetPath: string) => approvedRoots.has(targetPath)),
    }

    const persistenceStore = createPersistenceStoreStub()
    persistenceStore.readAppState = vi.fn(async () => ({
      activeWorkspaceId: 'workspace-1',
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Persisted',
          path: '/tmp/persisted-workspace',
          nodes: [],
        },
      ],
    }))

    const createPersistenceStore = vi.fn().mockResolvedValue(persistenceStore)

    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-user-data') },
      ipcMain,
      clipboard,
      dialog: { showOpenDialog: vi.fn() },
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
      createReleaseNotesService: () => ({ getCurrent: vi.fn(async () => ({ items: [] })) }),
    }))
    vi.doMock('../../../src/contexts/filesystem/presentation/main-ipc/register', () => ({
      registerFilesystemIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/worktree/presentation/main-ipc/register', () => ({
      registerWorktreeIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/integration/presentation/main-ipc/register', () => ({
      registerIntegrationIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/platform/persistence/sqlite/PersistenceStore', () => ({
      createPersistenceStore,
    }))
    vi.doMock('../../../src/platform/persistence/sqlite/ipc/register', () => ({
      registerPersistenceIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerWindowChromeIpcHandlers', () => ({
      registerWindowChromeIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerWindowMetricsIpcHandlers', () => ({
      registerWindowMetricsIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerDiagnosticsIpcHandlers', () => ({
      registerDiagnosticsIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/system/presentation/main-ipc/register', () => ({
      registerSystemIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerLocalWorkerIpcHandlers', () => ({
      registerLocalWorkerIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerWorkerClientIpcHandlers', () => ({
      registerWorkerClientIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerCliIpcHandlers', () => ({
      registerCliIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerControlSurfaceIpcHandlers', () => ({
      registerControlSurfaceIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/app/main/ipc/registerWebsiteWindowIpcHandlers', () => ({
      registerWebsiteWindowIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doMock('../../../src/contexts/clipboard/presentation/main-ipc/register', () => ({
      registerClipboardIpcHandlers: () => ({ dispose: vi.fn() }),
    }))
    vi.doUnmock('../../../src/contexts/workspace/presentation/main-ipc/register')

    const { registerIpcHandlers } = await import('../../../src/app/main/ipc/registerIpcHandlers')
    const disposable = registerIpcHandlers({
      approvedWorkspaces,
    })

    const copyHandler = handlers.get(IPC_CHANNELS.workspaceCopyPath)
    expect(copyHandler).toBeTypeOf('function')

    const copyPromise = invokeHandledIpc(copyHandler, null, { path: '/tmp/persisted-workspace' })

    await Promise.resolve()
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(approvedWorkspaces.isPathApproved).not.toHaveBeenCalled()

    releaseHydration?.()

    await expect(copyPromise).resolves.toBeUndefined()
    expect(approvedWorkspaces.registerRoot).toHaveBeenCalledWith('/tmp/persisted-workspace')
    expect(approvedWorkspaces.isPathApproved).toHaveBeenCalledWith('/tmp/persisted-workspace')
    expect(clipboard.writeText).toHaveBeenCalledWith('/tmp/persisted-workspace')

    disposable.dispose()
  })
})
