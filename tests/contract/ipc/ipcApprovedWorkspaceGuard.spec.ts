import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
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

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
  vi.doUnmock('node:child_process')
})

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
      invokeHandledIpc(spawnHandler, null, { cwd: 'relative/path', cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })

    await expect(
      invokeHandledIpc(spawnHandler, null, { cwd: '/tmp/outside-approved', cols: 80, rows: 24 }),
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
      invokeHandledIpc(spawnHandler, null, { cwd: '/tmp/approved', cols: 80, rows: 24 }),
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
        invokeHandledIpc(launchHandler, null, {
          provider: 'codex',
          cwd: 'relative/path',
          prompt: 'hello',
          cols: 80,
          rows: 24,
        }),
      ).rejects.toMatchObject({ code: 'common.invalid_input' })

      await expect(
        invokeHandledIpc(launchHandler, null, {
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

      const result = await invokeHandledIpc(launchHandler, null, {
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

  it('wraps Windows agent launches through cmd.exe when the CLI resolves to a .cmd shim', async () => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'

    try {
      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))
      vi.doMock('node:child_process', async importOriginal => {
        const actual = await importOriginal<typeof import('node:child_process')>()

        return {
          ...actual,
          execFile: vi.fn((_file, _args, options, callback) => {
            const cb = typeof options === 'function' ? options : callback
            cb?.(null, 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd\r\n', '')
          }),
          default: {
            ...actual,
            execFile: vi.fn((_file, _args, options, callback) => {
              const cb = typeof options === 'function' ? options : callback
              cb?.(null, 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd\r\n', '')
            }),
          },
        }
      })

      const runtime = createPtyRuntimeMock()
      const store = createApprovedWorkspaceStoreMock({ isPathApproved: true })

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')
      registerAgentIpcHandlers(runtime, store)

      const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
      expect(launchHandler).toBeTypeOf('function')

      const result = await invokeHandledIpc(launchHandler, null, {
        provider: 'codex',
        cwd: '/approved',
        prompt: 'hello',
        cols: 80,
        rows: 24,
      })

      expect(runtime.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'cmd.exe',
          args: expect.arrayContaining([
            '/d',
            '/c',
            'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd',
          ]),
        }),
      )
      expect(result).toEqual(
        expect.objectContaining({
          command: 'cmd.exe',
          args: expect.arrayContaining([
            '/d',
            '/c',
            'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd',
          ]),
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

      const result = await invokeHandledIpc(launchHandler, null, {
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
        invokeHandledIpc(suggestHandler, null, {
          provider: 'codex',
          cwd: 'relative/path',
          requirement: 'Add tests',
        }),
      ).rejects.toMatchObject({ code: 'common.invalid_input' })

      await expect(
        invokeHandledIpc(suggestHandler, null, {
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

      const result = await invokeHandledIpc(suggestHandler, null, {
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
