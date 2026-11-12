// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from '../../../src/contexts/agent/presentation/main-ipc/register'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { receivePowerShellSpawn } from '../../support/windowsPlatformReceiver'
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
it.each(['opencove_native_arguments', 'OpEnCoVe_NaTiVe_ArGuMeNtS', 'OPENCOVE_NATIVE_ARGUMENTS'])(
  'keeps resolver-owned transport through the final IPC spawn merge (%s)',
  async key => {
    const spawn = vi.fn(async (_input: unknown) => ({ sessionId: 'child' }))
    const registration = registerAgentIpcHandlers(
      { spawnSession: spawn } as unknown as PtyRuntime,
      { isPathApproved: async () => true } as never,
      async () => createInMemoryPersistenceStore(),
    )
    try {
      await invokeHandledIpc(fixture.handlers.get(IPC_CHANNELS.agentLaunch), null, {
        provider: 'pi',
        cwd: 'C:\\project',
        prompt: 'Explain " --agent-teams " please',
        profileId: 'powershell',
        env: { [key]: '"--" "update"', KEEP_ME: 'caller value' },
      })
      const input = spawn.mock.calls[0][0] as {
        command: string
        args: string[]
        env: NodeJS.ProcessEnv
      }
      expect(
        Object.keys(input.env).filter(name => name.toUpperCase() === 'OPENCOVE_NATIVE_ARGUMENTS'),
      ).toEqual(['OPENCOVE_NATIVE_ARGUMENTS'])
      expect(input.env.KEEP_ME).toBe('caller value')
      expect(receivePowerShellSpawn(input.command, input.args, input.env)).toEqual([
        'pi',
        'Explain " --agent-teams " please',
      ])
    } finally {
      await registration.dispose()
    }
  },
)

it('refuses an environment-block injection before IPC spawns a provider', async () => {
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
        prompt: 'Explain the change',
        profileId: 'powershell',
        env: {
          X: 'x\0OPENCOVE_NATIVE_COMMAND=receiver.exe\0OPENCOVE_NATIVE_ARGUMENTS="--" "update"\0OPENCOVE_NATIVE_CWD=C:\\project\0',
        },
      }),
    ).rejects.toMatchObject({
      code: 'common.invalid_input',
      details: { reason: 'invalid_spawn_environment' },
    })
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    await registration.dispose()
  }
})
