import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApprovedWorkspaceStore } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('../../../src/platform/os/CommandEnvironmentService')
  vi.doUnmock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver')
  vi.doUnmock('../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan')
})
it('desktop Claude launch uses one resolved shell environment for both reservation planning and the actual spawn', async () => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('OPENCOVE_TEST_USE_REAL_AGENTS', '1')
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  vi.doMock('electron', () => ({
    ipcMain: {
      handle: (id: string, handler: (...args: unknown[]) => unknown) => handlers.set(id, handler),
      removeHandler() {},
    },
  }))
  const environment = { PATH: '/shell/bin', CLAUDE_CONFIG_DIR: '/shell-only/config' }
  const getEnvironment = vi.fn(async () => environment)
  vi.doMock('../../../src/platform/os/CommandEnvironmentService', () => ({
    getCommandExecutionEnvironment: getEnvironment,
  }))
  const artifacts = new AgentLaunchArtifactScope()
  artifacts.seal()
  const plan = vi.fn(async () => ({
    plan: { command: 'claude', args: [], env: {}, launchMode: 'new', resumeSessionId: 'provider' },
    artifacts,
  }))
  vi.doMock(
    '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan',
    () => ({ createManagedAgentLaunchPlan: plan }),
  )
  vi.doMock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
    resolveAgentLaunchSpawn: async (input: object) => ({
      ...input,
      profileId: null,
      runtimeKind: 'posix',
    }),
  }))
  const runtime = {
    spawnSession: vi.fn(async () => ({ sessionId: 'pty' })),
    startSessionStateWatcher: vi.fn(),
  } as unknown as PtyRuntime
  const approved = { isPathApproved: async () => true } as unknown as ApprovedWorkspaceStore
  const store = { readAppState: async () => null } as unknown as PersistenceStore
  const { registerAgentIpcHandlers } =
    await import('../../../src/contexts/agent/presentation/main-ipc/register')
  const registration = registerAgentIpcHandlers(runtime, approved, async () => store)
  try {
    await invokeHandledIpc(handlers.get(IPC_CHANNELS.agentLaunch), null, {
      provider: 'claude-code',
      cwd: '/approved',
      prompt: 'hello',
    })
    expect(plan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ environment }))
    expect(runtime.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining(environment) }),
    )
  } finally {
    registration.dispose()
  }
})
