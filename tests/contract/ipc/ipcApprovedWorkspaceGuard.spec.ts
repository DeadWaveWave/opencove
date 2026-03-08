import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'

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

function createPtyRuntimeMock(): PtyRuntime {
  return {
    spawnSession: vi.fn(() => ({ sessionId: 'session-1' })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    snapshot: vi.fn(() => ''),
    startSessionStateWatcher: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('IPC approved workspace guards', () => {
  it('blocks pty:spawn outside approved roots', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const runtime = createPtyRuntimeMock()
    const store = createApprovedWorkspaceStoreMock({ isPathApproved: false })

    const { registerPtyIpcHandlers } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/register')
    const disposable = registerPtyIpcHandlers(runtime, store)

    const spawnHandler = handlers.get(IPC_CHANNELS.ptySpawn)
    expect(spawnHandler).toBeTypeOf('function')

    await expect(
      spawnHandler?.(null, { cwd: 'relative/path', cols: 80, rows: 24 }),
    ).rejects.toThrow(/absolute cwd/)

    await expect(
      spawnHandler?.(null, { cwd: '/tmp/outside-approved', cols: 80, rows: 24 }),
    ).rejects.toThrow(/outside approved workspaces/)
    expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/outside-approved')

    disposable.dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.ptySpawn)
  })

  it('allows pty:spawn within approved roots', async () => {
    vi.resetModules()

    const { handlers, ipcMain } = createIpcHarness()
    vi.doMock('electron', () => ({ ipcMain }))

    const runtime = createPtyRuntimeMock()
    const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })

    const { registerPtyIpcHandlers } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/register')
    registerPtyIpcHandlers(runtime, store)

    const spawnHandler = handlers.get(IPC_CHANNELS.ptySpawn)
    expect(spawnHandler).toBeTypeOf('function')

    await expect(
      spawnHandler?.(null, { cwd: '/tmp/approved', cols: 80, rows: 24 }),
    ).resolves.toEqual({ sessionId: 'session-1' })

    expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/approved')
    expect(runtime.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/approved',
        cols: 80,
        rows: 24,
      }),
    )
  })

  it('blocks agent:launch outside approved roots', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const runtime = createPtyRuntimeMock()
      const store = createApprovedWorkspaceStoreMock({ isPathApproved: false })

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')
      registerAgentIpcHandlers(runtime, store)

      const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
      expect(launchHandler).toBeTypeOf('function')

      await expect(
        launchHandler?.(null, {
          provider: 'codex',
          cwd: 'relative/path',
          prompt: 'hello',
          cols: 80,
          rows: 24,
        }),
      ).rejects.toThrow(/absolute cwd/)

      await expect(
        launchHandler?.(null, {
          provider: 'codex',
          cwd: '/tmp/outside-approved',
          prompt: 'hello',
          cols: 80,
          rows: 24,
        }),
      ).rejects.toThrow(/outside approved workspaces/)
      expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/outside-approved')
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })

  it('allows agent:launch within approved roots', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const runtime = createPtyRuntimeMock()
      const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')
      registerAgentIpcHandlers(runtime, store)

      const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
      expect(launchHandler).toBeTypeOf('function')

      const result = await launchHandler?.(null, {
        provider: 'codex',
        cwd: '/tmp/approved',
        prompt: 'hello',
        cols: 80,
        rows: 24,
      })

      expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/approved')
      expect(runtime.spawnSession).toHaveBeenCalledTimes(1)
      expect(result).toEqual(expect.objectContaining({ sessionId: 'session-1', provider: 'codex' }))
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })

  it('starts agent state watcher in the background without blocking launch', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const runtime = createPtyRuntimeMock()
      const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')
      registerAgentIpcHandlers(runtime, store)

      const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
      expect(launchHandler).toBeTypeOf('function')

      const result = await launchHandler?.(null, {
        provider: 'codex',
        cwd: '/tmp/approved',
        prompt: '',
        cols: 80,
        rows: 24,
      })

      expect(result).toEqual(
        expect.objectContaining({
          sessionId: 'session-1',
          provider: 'codex',
          resumeSessionId: null,
        }),
      )
      expect(runtime.startSessionStateWatcher).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          provider: 'codex',
          cwd: '/tmp/approved',
          resumeSessionId: null,
        }),
      )
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })

  it('blocks task:suggest-title outside approved roots', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const store = createApprovedWorkspaceStoreMock({ isPathApproved: false })

      const { registerTaskIpcHandlers } =
        await import('../../../src/contexts/task/presentation/main-ipc/register')
      registerTaskIpcHandlers(store)

      const suggestHandler = handlers.get(IPC_CHANNELS.taskSuggestTitle)
      expect(suggestHandler).toBeTypeOf('function')

      await expect(
        suggestHandler?.(null, {
          provider: 'codex',
          cwd: 'relative/path',
          requirement: 'Add tests',
        }),
      ).rejects.toThrow(/absolute cwd/)

      await expect(
        suggestHandler?.(null, {
          provider: 'codex',
          cwd: '/tmp/outside-approved',
          requirement: 'Add tests',
        }),
      ).rejects.toThrow(/outside approved workspaces/)
      expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/outside-approved')
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })

  it('allows task:suggest-title within approved roots', async () => {
    vi.resetModules()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })

      const { registerTaskIpcHandlers } =
        await import('../../../src/contexts/task/presentation/main-ipc/register')
      registerTaskIpcHandlers(store)

      const suggestHandler = handlers.get(IPC_CHANNELS.taskSuggestTitle)
      expect(suggestHandler).toBeTypeOf('function')

      const result = await suggestHandler?.(null, {
        provider: 'codex',
        cwd: '/tmp/approved',
        requirement: 'Add tests',
        availableTags: ['feature'],
      })

      expect(store.isPathApproved).toHaveBeenCalledWith('/tmp/approved')
      expect(result).toEqual(
        expect.objectContaining({
          provider: 'codex',
          effectiveModel: null,
          priority: 'medium',
          tags: ['feature'],
        }),
      )
      expect(typeof result?.title).toBe('string')
      expect(result?.title.length).toBeGreaterThan(0)
    } finally {
      if (typeof previousNodeEnv === 'string') {
        process.env.NODE_ENV = previousNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    }
  })
})
