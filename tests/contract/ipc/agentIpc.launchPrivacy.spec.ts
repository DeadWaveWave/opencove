// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from '../../../src/contexts/agent/presentation/main-ipc/register'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from './ipcTestUtils'
import { createInMemoryPersistenceStore } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

const seam = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dispose: vi.fn(async () => {}),
  resolve: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (id: string, handler: (...args: unknown[]) => unknown) =>
      seam.handlers.set(id, handler),
    removeHandler: (id: string) => seam.handlers.delete(id),
  },
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env = {}) => env,
}))
vi.mock('../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan', () => ({
  createManagedAgentLaunchPlan: async () => ({
    plan: {
      command: 'fixture-agent',
      args: ['--model', 'fixture-model'],
      env: {},
      launchMode: 'new',
      effectiveModel: null,
      resumeSessionId: null,
    },
    artifacts: { dispose: seam.dispose },
  }),
}))
vi.mock('../../../src/contexts/agent/presentation/main-ipc/validate', async importOriginal => ({
  ...(await importOriginal<object>()),
  resolveAgentTestStub: () => null,
}))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: seam.resolve,
}))
afterEach(() => {
  vi.clearAllMocks()
  seam.handlers.clear()
})

it.each(['success', 'spawn-failure', 'resolution-failure'] as const)(
  'keeps trusted WSL IPC launch private on %s',
  async outcome => {
    const key = 'ipc-private-provider-key'
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({}),
      homeDir: () => 'C:\\Users\\fixture',
      locateWindowsCommands: async () => [],
      listWslDistros: async () => ['Ubuntu'],
    })
    seam.resolve.mockImplementation(async input => {
      if (outcome === 'resolution-failure') {
        throw new Error(key)
      }
      return resolver.resolveCommandSpawn({ ...input, commandEnv: input.env })
    })
    const spawn = vi.fn(async () => {
      if (outcome === 'spawn-failure') {
        throw new Error(key)
      }
      return { sessionId: 'child' }
    })
    const registration = registerAgentIpcHandlers(
      { spawnSession: spawn, kill: vi.fn() } as unknown as PtyRuntime,
      { isPathApproved: async () => true } as never,
      async () => createInMemoryPersistenceStore(),
    )
    try {
      const handler = seam.handlers.get(IPC_CHANNELS.agentLaunch)
      if (outcome === 'success') {
        const result = await invokeHandledIpc(handler, null, {
          provider: 'codex',
          cwd: 'C:\\repo',
          profileId: 'wsl:Ubuntu',
          prompt: '',
          env: { S1A_TEST_API_KEY: key },
        })
        expect(result).toMatchObject({
          sessionId: 'child',
          command: 'fixture-agent',
          args: ['--model', 'fixture-model'],
        })
        expect(JSON.stringify(result)).not.toContain(key)
        expect(vi.mocked(spawn).mock.calls[0]).toMatchObject([
          { command: 'wsl.exe', args: expect.arrayContaining([`S1A_TEST_API_KEY=${key}`]) },
        ])
      } else {
        const result = await handler?.(null, {
          provider: 'codex',
          cwd: 'C:\\repo',
          profileId: 'wsl:Ubuntu',
          prompt: '',
          env: { S1A_TEST_API_KEY: key },
        })
        expect(result).toMatchObject({ ok: false, error: { code: 'agent.launch_failed' } })
        expect(JSON.stringify(result)).not.toContain(key)
        expect(seam.dispose).toHaveBeenCalledOnce()
      }
    } finally {
      registration.dispose()
    }
  },
)
