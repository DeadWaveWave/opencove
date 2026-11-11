// @vitest-environment node
import { access, readFile } from 'node:fs/promises'
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
  '%s creates leading-dash prompt artifacts only on the executing host (remote uses user authority)',
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
    let path: string | undefined
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
      expect(result).toMatchObject({ ok: true })
      expect(seam.files).toHaveLength(1)
      expect(seam.files[0].executor).toBe(isRemote ? 'worker' : 'home')
      path = seam.files[0].path
      expect(await readFile(path, 'utf8')).toBe('--approve the task')
      expect(seam.inputs[0]).toEqual([`@${path}`])
      expect(worker.spawn).toHaveBeenCalledOnce()
      if (isRemote) {
        expect(home.spawn).not.toHaveBeenCalled()
      }
    } finally {
      await home.dispose()
      if (worker !== home) {
        await worker.dispose()
      }
    }
    await expect(access(path!)).rejects.toThrow()
  },
)

it('refuses a remote WSL launch when its host artifact cannot be translated and cleans the file', async () => {
  const home = await createPromptWorker({ remote: true, fullAccess: false })
  const worker = await createPromptWorker({ fullAccess: false })
  const state = (await worker.store.readAppState())!
  await worker.store.writeAppState({
    ...state,
    settings: {
      defaultProvider: 'pi',
      agentFullAccess: false,
      defaultTerminalProfileId: 'wsl:Ubuntu',
    },
  })
  seam.remote.mockImplementation(async (_endpoint, request) => {
    if (request.id === 'workspace.approveRoot') {
      return { result: { ok: true, value: null } }
    }
    seam.executor = 'worker'
    seam.windows = true
    try {
      return { result: await worker.invoke(request, true) }
    } finally {
      seam.executor = 'home'
      seam.windows = false
    }
  })
  try {
    const result = await home.invoke(
      {
        kind: 'command',
        id: 'session.launchAgentInMount',
        payload: {
          mountId: 'mount',
          cwdUri: rootUri,
          provider: 'pi',
          prompt: '--approve the task',
        },
      },
      true,
    )
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'common.unavailable',
        debugMessage: expect.stringContaining('Choose a profile that can access the file'),
      },
    })
    expect(home.spawn).not.toHaveBeenCalled()
    expect(worker.spawn).not.toHaveBeenCalled()
    expect(seam.files).toHaveLength(1)
    expect(seam.files[0].executor).toBe('worker')
    await expect(access(seam.files[0].path)).rejects.toThrow()
  } finally {
    await home.dispose()
    await worker.dispose()
  }
})
