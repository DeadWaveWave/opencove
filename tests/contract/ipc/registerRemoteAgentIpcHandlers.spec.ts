import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('registerRemoteAgentIpcHandlers', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('waits for startup approval hydration before forwarding agent launch to the worker', async () => {
    const { handlers, ipcMain } = createIpcHarness()

    let releaseStartup: (() => void) | null = null
    const startupReady = new Promise<void>(resolve => {
      releaseStartup = resolve
    })

    const invokeControlSurface = vi.fn(async () => ({
      httpStatus: 200,
      result: {
        ok: true,
        value: {
          sessionId: 'session-1',
          provider: 'codex',
          startedAt: '2026-04-30T00:00:00.000Z',
          profileId: null,
          runtimeKind: 'windows',
          resumeSessionId: null,
          effectiveModel: 'gpt-5.2-codex',
          command: 'codex',
          args: ['run'],
        },
      },
    }))

    vi.doMock('electron', () => ({ ipcMain }))
    vi.doMock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
      invokeControlSurface,
    }))

    const { registerRemoteAgentIpcHandlers } =
      await import('../../../src/app/main/ipc/registerRemoteAgentIpcHandlers')

    registerRemoteAgentIpcHandlers({
      endpointResolver: async () => ({
        hostname: '127.0.0.1',
        port: 7777,
        token: 'token',
      }),
      ptyRuntime: {} as never,
      startupReady,
    })

    const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
    expect(launchHandler).toBeTypeOf('function')

    const launchPromise = invokeHandledIpc(launchHandler, null, {
      provider: 'codex',
      cwd: '/tmp/persisted-workspace',
      profileId: 'wsl:Ubuntu',
      prompt: 'hello',
    })

    await Promise.resolve()
    expect(invokeControlSurface).not.toHaveBeenCalled()

    releaseStartup?.()

    await expect(launchPromise).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        provider: 'codex',
        profileId: null,
        runtimeKind: 'windows',
        command: 'codex',
        args: ['run'],
      }),
    )

    expect(invokeControlSurface).toHaveBeenCalledWith(
      {
        hostname: '127.0.0.1',
        port: 7777,
        token: 'token',
      },
      {
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          cwd: '/tmp/persisted-workspace',
          prompt: 'hello',
          provider: 'codex',
          mode: 'new',
          model: null,
          resumeSessionId: null,
          env: null,
          agentFullAccess: null,
          codexReuseRunningAppServer: null,
        },
      },
    )
  })

  it('forwards launch override and geometry to the worker agent launch command', async () => {
    const { handlers, ipcMain } = createIpcHarness()
    const invokeControlSurface = vi.fn(async () => ({
      httpStatus: 200,
      result: {
        ok: true,
        value: {
          sessionId: 'session-override',
          provider: 'codex',
          startedAt: '2026-04-30T00:00:00.000Z',
          profileId: null,
          runtimeKind: 'windows',
          resumeSessionId: null,
          effectiveModel: 'gpt-5.2-codex',
          command: 'codex',
          args: ['run'],
        },
      },
    }))

    vi.doMock('electron', () => ({ ipcMain }))
    vi.doMock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
      invokeControlSurface,
    }))

    const { registerRemoteAgentIpcHandlers } =
      await import('../../../src/app/main/ipc/registerRemoteAgentIpcHandlers')

    registerRemoteAgentIpcHandlers({
      endpointResolver: async () => ({
        hostname: '127.0.0.1',
        port: 7777,
        token: 'token',
      }),
      ptyRuntime: {} as never,
    })

    const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
    expect(launchHandler).toBeTypeOf('function')

    await invokeHandledIpc(launchHandler, null, {
      provider: 'codex',
      codexReuseRunningAppServer: true,
      cwd: '/tmp/persisted-workspace',
      prompt: 'hello',
      executablePathOverride: '/opt/bin/codex',
      cols: 132,
      rows: 41,
    })

    expect(invokeControlSurface).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payload: expect.objectContaining({
          executablePathOverride: '/opt/bin/codex',
          codexReuseRunningAppServer: true,
          cols: 132,
          rows: 41,
        }),
      }),
    )
  })
})

it('forwards managed intent-only launches with consistent mirrors and preserves the effective receipt', async () => {
  const { handlers, ipcMain } = createIpcHarness()
  const binding = {
    nodeId: 'agent',
    activationId: 'activated',
    runtimeSessionId: 'runtime',
    tuple: { resumeSessionId: 'B', resumeSessionIdVerified: true },
    nodeSeen: true,
    bindingRevision: 2,
    observedRevision: 2,
  }
  const receipt = { binding, commitRevision: 2 }
  const invokeControlSurface = vi.fn(async () => ({
    httpStatus: 200,
    result: {
      ok: true,
      value: {
        sessionId: 'runtime',
        provider: 'claude-code',
        startedAt: '2026-11-11T00:00:00Z',
        profileId: null,
        runtimeKind: 'posix',
        resumeSessionId: 'B',
        effectiveModel: null,
        command: 'claude',
        args: [],
        managedClaudeLifecycle: receipt,
        managedClaudeBinding: binding,
      },
    },
  }))
  vi.doMock('electron', () => ({ ipcMain }))
  vi.doMock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
    invokeControlSurface,
  }))
  const { registerRemoteAgentIpcHandlers } =
    await import('../../../src/app/main/ipc/registerRemoteAgentIpcHandlers')
  registerRemoteAgentIpcHandlers({
    endpointResolver: async () => ({ hostname: '127.0.0.1', port: 7777, token: 'token' }),
    ptyRuntime: {} as never,
  })
  const intent = {
    kind: 'resumeConversation',
    resumeSessionId: 'C',
    expected: { activationId: 'old', tuple: binding.tuple },
  }
  const result = await invokeHandledIpc(handlers.get(IPC_CHANNELS.agentLaunch), null, {
    canvasNodeId: 'agent',
    provider: 'claude-code',
    cwd: '/repo',
    prompt: '',
    intent,
  })
  expect(invokeControlSurface).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      payload: expect.objectContaining({ intent, mode: 'resume', resumeSessionId: 'C' }),
    }),
  )
  expect(result).toMatchObject({
    resumeSessionId: 'B',
    managedClaudeLifecycle: receipt,
    managedClaudeBinding: binding,
  })
})
