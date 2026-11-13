// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createPromptWorker, cwd, rootUri } from './sessionGrantPromptLiteral.testUtils'
import {
  TerminalProfileResolver,
  type ResolveCommandSpawnInput,
} from '../../../src/platform/terminal/TerminalProfileResolver'
const seam = vi.hoisted(() => ({
  executor: 'home',
  windows: false,
  inputs: [] as string[][],
  files: [] as { executor: string; path: string }[],
  remote: vi.fn(),
}))
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: seam.remote,
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env = {}) => env,
}))
vi.mock('../../../src/app/main/controlSurface/handlers/sessionAgentTestStub', () => ({
  resolveWorkerAgentTestStub: () => null,
}))
vi.mock(
  '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig')
      >()
    return {
      ...actual,
      createTemporaryProviderConfig: async (prefix: string, filename: string, contents: string) => {
        const file = await actual.createTemporaryProviderConfig(
          `${prefix}${seam.executor}-`,
          filename,
          contents,
        )
        seam.files.push({ executor: seam.executor, path: file.path })
        return seam.windows ? { ...file, path: '/var/folders/host/prompt.txt' } : file
      },
    }
  },
)
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: ResolveCommandSpawnInput) => {
    seam.inputs.push([...input.args])
    return await new TerminalProfileResolver({
      platform: seam.windows ? 'win32' : process.platform,
      env: () => ({}),
      homeDir: () => 'C:\\Users\\fixture',
      processCwd: () => 'C:\\project',
      locateWindowsCommands: async () => [],
      listWslDistros: async () => ['Ubuntu'],
    }).resolveCommandSpawn(input)
  },
}))
afterEach(() => {
  vi.clearAllMocks()
  seam.executor = 'home'
  seam.windows = false
  seam.files = []
  seam.inputs = []
})

it.each(['local', 'remote-mount', 'remote-node'] as const)(
  '%s refuses leading-dash prompts on the executing host without artifacts (remote uses user authority)',
  async route => {
    const isRemote = route !== 'local'
    const home = await createPromptWorker({ remote: isRemote, fullAccess: false })
    const worker = isRemote ? await createPromptWorker({ fullAccess: false }) : home
    seam.remote.mockImplementation(async (_endpoint, request) => {
      if (request.id === 'workspace.approveRoot') {
        return { result: { ok: true, value: null } }
      }
      expect(request.payload.prompt).toBe('--approve the task')
      expect(JSON.stringify(request.payload)).not.toContain('prompt.txt')
      seam.executor = 'worker'
      try {
        return { result: await worker.invoke(request, true) }
      } finally {
        seam.executor = 'home'
      }
    })
    try {
      const result = await home.invoke(
        {
          kind: 'command',
          id:
            route === 'remote-node'
              ? 'node.create'
              : route === 'local'
                ? 'session.launchAgent'
                : 'session.launchAgentInMount',
          payload:
            route === 'remote-node'
              ? {
                  kind: 'agent',
                  space: { kind: 'spaceId', spaceId: 'space' },
                  data: { provider: 'pi', prompt: '--approve the task' },
                }
              : {
                  ...(route === 'local' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
                  provider: 'pi',
                  prompt: '--approve the task',
                },
        },
        isRemote,
      )
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'common.invalid_input', details: { reason: 'initial_prompt_unsupported' } },
      })
      expect(seam.files).toHaveLength(0)
      expect(seam.inputs).toHaveLength(0)
      expect(worker.spawn).not.toHaveBeenCalled()
      expect(home.spawn).not.toHaveBeenCalled()
    } finally {
      await home.dispose()
      if (worker !== home) {
        await worker.dispose()
      }
    }
  },
)
