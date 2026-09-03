import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (typeof originalNodeEnv === 'string') {
    process.env.NODE_ENV = originalNodeEnv
  } else {
    delete process.env.NODE_ENV
  }
  vi.doUnmock('electron')
  vi.doUnmock('../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan')
  vi.resetModules()
})

describe('Agent IPC launch registration', () => {
  it('rolls back ownership when exit wins the post-spawn registration gap', async () => {
    process.env.NODE_ENV = 'test'
    const artifacts = new AgentLaunchArtifactScope()
    const disposeArtifact = vi.fn(async () => undefined)
    artifacts.track('deferred-agent-artifact', { dispose: disposeArtifact })
    artifacts.seal()
    const onStarted = vi.fn()
    vi.doMock(
      '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan',
      () => ({
        createManagedAgentLaunchPlan: vi.fn(async () => ({
          plan: { command: 'codex', args: [], env: {}, onStarted },
          artifacts,
        })),
      }),
    )

    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    }
    vi.doMock('electron', () => ({ ipcMain }))

    let emitExit: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    let resolveSpawn!: (value: { sessionId: string }) => void
    let markSpawnStarted!: () => void
    const spawnStarted = new Promise<void>(resolve => {
      markSpawnStarted = resolve
    })
    const runtime = {
      spawnSession: vi.fn(
        async () =>
          await new Promise<{ sessionId: string }>(resolve => {
            resolveSpawn = resolve
            markSpawnStarted()
          }),
      ),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => ''),
      presentationSnapshot: vi.fn(),
      startSessionStateWatcher: vi.fn(),
      onExit: vi.fn(listener => {
        emitExit = listener
        return () => undefined
      }),
      dispose: vi.fn(),
    } as unknown as PtyRuntime
    const approvedWorkspaces = {
      registerRoot: vi.fn(async () => undefined),
      isPathApproved: vi.fn(async () => true),
    } satisfies ApprovedWorkspaceStore
    const persistenceStore = {
      readAppState: vi.fn(async () => null),
    } as unknown as PersistenceStore
    const { registerAgentIpcHandlers } =
      await import('../../../src/contexts/agent/presentation/main-ipc/register')
    const disposable = registerAgentIpcHandlers(
      runtime,
      approvedWorkspaces,
      async () => persistenceStore,
    )
    const launchHandler = handlers.get(IPC_CHANNELS.agentLaunch)
    expect(launchHandler).toBeTypeOf('function')

    const launching = invokeHandledIpc(launchHandler, null, {
      provider: 'codex',
      cwd: '/tmp/approved',
      prompt: 'hello',
      cols: 80,
      rows: 24,
    })
    await spawnStarted
    emitExit?.({ sessionId: 'session-before-agent-registration', exitCode: 0 })
    resolveSpawn({ sessionId: 'session-before-agent-registration' })

    await expect(launching).rejects.toMatchObject({
      code: 'agent.launch_failed',
      debugMessage: expect.stringContaining('completed before spawn registration'),
    })
    expect(disposeArtifact).toHaveBeenCalledTimes(1)
    expect(onStarted).not.toHaveBeenCalled()
    expect(runtime.startSessionStateWatcher).not.toHaveBeenCalled()
    disposable.dispose()
  })
})
