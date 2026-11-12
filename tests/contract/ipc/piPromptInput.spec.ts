// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from '../../../src/contexts/agent/presentation/main-ipc/register'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { createInMemoryPersistenceStore } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { invokeHandledIpc } from './ipcTestUtils'
import {
  TerminalProfileResolver,
  type ResolveCommandSpawnInput,
} from '../../../src/platform/terminal/TerminalProfileResolver'
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dispose: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (id: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(id, handler),
    removeHandler: (id: string) => fixture.handlers.delete(id),
  },
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env = {}) => env,
}))
vi.mock(
  '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig',
  () => ({
    createTemporaryProviderConfig: async () => ({
      path: 'C:\\Temp\\prompt folder\\prompt.txt',
      dispose: fixture.dispose,
    }),
  }),
)
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: ResolveCommandSpawnInput) =>
    new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({}),
      homeDir: () => 'C:\\Users\\fixture',
      processCwd: () => 'C:\\project',
      locateWindowsCommands: async () => [],
      listWslDistros: async () => ['Ubuntu'],
    }).resolveCommandSpawn(input),
}))
vi.mock('../../../src/contexts/agent/presentation/main-ipc/validate', async importOriginal => ({
  ...(await importOriginal<object>()),
  resolveAgentTestStub: () => null,
}))
afterEach(() => {
  vi.clearAllMocks()
  fixture.handlers.clear()
})
it.each(['powershell', 'wsl:Ubuntu', ' WSL:Ubuntu ', 'wsl:RemovedDistro'])(
  'refuses unsafe Pi text before %s IPC spawn or artifact creation',
  async profileId => {
    const spawn = vi.fn()
    const registration = registerAgentIpcHandlers(
      { spawnSession: spawn } as unknown as PtyRuntime,
      { isPathApproved: async () => true } as never,
      async () => createInMemoryPersistenceStore(),
    )
    try {
      await expect(
        invokeHandledIpc(fixture.handlers.get(IPC_CHANNELS.agentLaunch), null, {
          provider: 'pi',
          cwd: 'C:\\project',
          prompt: '--continue',
          profileId,
        }),
      ).rejects.toMatchObject({
        code: 'common.invalid_input',
        details: { reason: 'initial_prompt_unsupported' },
      })
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.dispose).not.toHaveBeenCalled()
    } finally {
      await registration.dispose()
    }
  },
)
