import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

const originalNodeEnv = process.env.NODE_ENV
const originalUseRealAgents = process.env.OPENCOVE_TEST_USE_REAL_AGENTS

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
  if (originalUseRealAgents === undefined) {
    delete process.env.OPENCOVE_TEST_USE_REAL_AGENTS
  } else {
    process.env.OPENCOVE_TEST_USE_REAL_AGENTS = originalUseRealAgents
  }
  vi.doUnmock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver')
})

describe('local IPC agent provider contribution launch', () => {
  it.each([
    ['pi', ['--model', 'pi-model', 'hello']],
    ['kimi', ['--model', 'kimi-model', '--prompt', 'hello']],
  ] as const)('launches %s through its provider contribution', async (provider, expectedArgs) => {
    vi.resetModules()
    process.env.NODE_ENV = 'test'
    process.env.OPENCOVE_TEST_USE_REAL_AGENTS = '1'
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn(),
    }
    vi.doMock('electron', () => ({ ipcMain }))
    vi.doMock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
      resolveAgentLaunchSpawn: vi.fn(async ({ cwd, command, args, env }) => ({
        command,
        args,
        cwd,
        env,
        profileId: null,
        runtimeKind: 'posix',
      })),
    }))
    const runtime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      startSessionStateWatcher: vi.fn(),
    } as unknown as PtyRuntime
    const approvedWorkspaces = {
      isPathApproved: vi.fn(async () => true),
    } as unknown as ApprovedWorkspaceStore
    const persistenceStore = {
      readAppState: vi.fn(async () => null),
    } as unknown as PersistenceStore
    const { registerAgentIpcHandlers } =
      await import('../../../src/contexts/agent/presentation/main-ipc/register')
    registerAgentIpcHandlers(runtime, approvedWorkspaces, async () => persistenceStore)

    const result = await invokeHandledIpc(handlers.get(IPC_CHANNELS.agentLaunch), null, {
      provider,
      cwd: '/tmp/approved',
      prompt: 'hello',
      model: `${provider}-model`,
    })

    expect(result).toEqual(expect.objectContaining({ sessionId: 'session-1', provider }))
    expect(runtime.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ command: provider, args: expectedArgs }),
    )
  })
})
