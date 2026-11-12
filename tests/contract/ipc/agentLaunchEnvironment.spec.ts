// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from '../../../src/contexts/agent/presentation/main-ipc/register'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../../../src/shared/contracts/dto'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { createInMemoryPersistenceStore } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { invokeHandledIpc } from './ipcTestUtils'
import {
  TerminalProfileResolver,
  type ResolveCommandSpawnInput,
} from '../../../src/platform/terminal/TerminalProfileResolver'
import { receivePowerShellSpawn } from '../../support/windowsPlatformReceiver'

const fixture = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\app-storage' },
  ipcMain: {
    handle: (key: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(key, handler),
    removeHandler: (key: string) => fixture.handlers.delete(key),
  },
}))
vi.mock('node:net', () => ({
  createServer: () => {
    const server = {
      unref: () => {},
      once: () => {},
      listen: (_port: number, _host: string, ready: () => void) => ready(),
      address: () => ({ port: 12345 }),
      close: (closed: () => void) => closed(),
    }
    return server
  },
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env = {}) => ({
    BASE_ONLY: 'base',
    COLLISION: 'base',
    ...env,
  }),
}))
vi.mock('../../../src/contexts/agent/infrastructure/opencode/OpenCodeTuiConfig', () => ({
  ensureOpenCodeEmbeddedTuiConfigPath: async () => 'C:\\generated\\tui.json',
}))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: ResolveCommandSpawnInput) =>
    new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({}),
      locateWindowsCommands: async () => [],
      listWslDistros: async () => [],
    }).resolveCommandSpawn(input),
}))
vi.mock('../../../src/contexts/agent/presentation/main-ipc/validate', async original => ({
  ...(await original<object>()),
  resolveAgentTestStub: () => null,
}))
beforeEach(() => vi.stubEnv('OPENCODE_TUI_CONFIG', undefined))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  fixture.handlers.clear()
})

async function launch(provider: AgentProviderId, env?: Record<string, string>) {
  const spawn = vi.fn(async (_input: unknown) => ({ sessionId: 'child' }))
  const registration = registerAgentIpcHandlers(
    { spawnSession: spawn } as unknown as PtyRuntime,
    { isPathApproved: async () => true } as never,
    async () => createInMemoryPersistenceStore(),
  )
  try {
    await invokeHandledIpc(fixture.handlers.get(IPC_CHANNELS.agentLaunch), null, {
      provider,
      cwd: 'C:\\project',
      prompt: 'Explain this project',
      profileId: 'powershell',
      agentFullAccess: true,
      env,
    })
    return spawn.mock.calls[0][0] as { command: string; args: string[]; env: NodeJS.ProcessEnv }
  } finally {
    await registration.dispose()
  }
}

it.each(AGENT_PROVIDER_IDS)(
  '%s preserves explicit caller env before platform wrapping',
  async provider => {
    const input = await launch(provider, {
      COLLISION: 'caller',
      OPENCODE_TUI_CONFIG: 'C:\\custom\\tui.json',
      XDG_STATE_HOME: 'C:\\custom-state',
      opencove_native_arguments: 'update',
    })
    expect(input.env).toMatchObject({
      BASE_ONLY: 'base',
      COLLISION: 'caller',
      OPENCODE_TUI_CONFIG: 'C:\\custom\\tui.json',
      XDG_STATE_HOME: 'C:\\custom-state',
    })
    expect(
      Object.keys(input.env).filter(key => key.toUpperCase() === 'OPENCOVE_NATIVE_ARGUMENTS'),
    ).toEqual(['OPENCOVE_NATIVE_ARGUMENTS'])
    const argv = receivePowerShellSpawn(input.command, input.args, input.env)
    expect(argv).toContain('Explain this project')
    if (provider === 'opencode') {
      expect(argv.at(-1)).toBe('.')
    }
  },
)
it('keeps embedded OpenCode defaults when the caller omits overrides', async () => {
  expect((await launch('opencode')).env).toMatchObject({
    OPENCODE_TUI_CONFIG: 'C:\\generated\\tui.json',
    XDG_STATE_HOME: 'C:\\app-storage',
    OPENCOVE_OPENCODE_SERVER_HOSTNAME: '127.0.0.1',
    OPENCOVE_OPENCODE_SERVER_PORT: '12345',
  })
})
it('preserves explicit empty OpenCode overrides', async () => {
  expect(
    (await launch('opencode', { OPENCODE_TUI_CONFIG: '', XDG_STATE_HOME: '' })).env,
  ).toMatchObject({ OPENCODE_TUI_CONFIG: '', XDG_STATE_HOME: '' })
})
