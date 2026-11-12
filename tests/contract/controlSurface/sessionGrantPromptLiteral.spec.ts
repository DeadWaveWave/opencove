// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { createPromptWorker, cwd, rootUri } from './sessionGrantPromptLiteral.testUtils'

const remote = vi.hoisted(() => vi.fn())
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: remote,
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env = {}) => env,
}))
vi.mock('../../../src/app/main/controlSurface/handlers/sessionAgentTestStub', () => ({
  resolveWorkerAgentTestStub: () => null,
}))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock(
  '../../../src/app/main/controlSurface/handlers/sessionLaunchSupport',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    reserveLoopbackPort: async () => 12345,
  }),
)
afterEach(() => {
  vi.clearAllMocks()
})

for (const route of ['direct', 'mount', 'node', 'mounted-node', 'remote', 'remote-node'] as const) {
  for (const provider of AGENT_PROVIDER_IDS) {
    const label = provider === 'gemini' ? 'gemini (legacy fallback to codex)' : provider
    it.each([
      '--continue the task',
      '--approve the change',
      '--dangerously-skip-permissions please',
      '-p task text',
      'Explain the change',
    ])(
      `${route}/${label} keeps grant prompt %j literal through the real adapter (remote uses user authority)`,
      async prompt => {
        const isRemote = route.startsWith('remote')
        const home = await createPromptWorker({
          remote: isRemote,
          localMount: route === 'mounted-node',
          fullAccess: provider === 'kimi',
        })
        const worker = isRemote
          ? await createPromptWorker({ fullAccess: provider === 'kimi' })
          : home
        remote.mockImplementation(async (_endpoint, request) => ({
          result:
            request.id === 'workspace.approveRoot'
              ? { ok: true, value: null }
              : await worker.invoke(request, true),
        }))
        try {
          const node = route.endsWith('node')
          const result = await home.invoke(
            {
              kind: 'command',
              id: node
                ? 'node.create'
                : route === 'direct'
                  ? 'session.launchAgent'
                  : 'session.launchAgentInMount',
              payload: node
                ? {
                    kind: 'agent',
                    space: { kind: 'spaceId', spaceId: 'space' },
                    data: { provider, prompt },
                  }
                : {
                    ...(route === 'direct' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
                    provider,
                    prompt,
                  },
            },
            isRemote,
          )
          if (['claude-code', 'pi'].includes(provider) && prompt.startsWith('-')) {
            expect(result).toMatchObject({
              ok: false,
              error: {
                code: 'common.invalid_input',
                details: { reason: 'initial_prompt_unsupported' },
              },
            })
            expect(worker.spawn).not.toHaveBeenCalled()
            expect(home.spawn).not.toHaveBeenCalled()
            return
          }
          expect(result).toMatchObject({ ok: true })
          if (route === 'mounted-node') {
            const operations = home.invokeCalls.mock.calls.map(([, request]) => request.id)
            expect(operations).toContain('session.launchAgentInMount')
            expect(operations).not.toContain('session.launchAgent')
          }
          expect(worker.spawn).toHaveBeenCalledOnce()
          if (isRemote) {
            expect(home.spawn).not.toHaveBeenCalled()
          }
          const args = worker.spawn.mock.calls[0][0].args
          // Gemini is legacy-only: new launches deliberately resolve it to the default provider.
          const selected = provider === 'gemini' ? 'codex' : provider
          expect(worker.spawn.mock.calls[0][0].command).toBe(
            selected === 'claude-code' ? 'claude' : selected,
          )
          if (selected === 'opencode' && prompt.startsWith('-')) {
            expect(args).toContain(`--prompt=${prompt}`)
          } else if (selected === 'kimi') {
            expect(args.slice(-2)).toEqual(['--prompt', prompt])
          } else {
            expect(args.at(-1) === prompt || args.at(-2) === prompt).toBe(true)
            if (prompt.startsWith('-')) {
              expect(args.at(-2)).toBe('--')
            }
          }
          const optionArgs =
            selected === 'kimi'
              ? args.slice(0, -2)
              : selected === 'claude-code' || selected === 'codex'
                ? args.slice(0, args.indexOf('--') < 0 ? -1 : args.indexOf('--'))
                : args
          expect(optionArgs).not.toContain('--resume')
          expect(optionArgs).not.toContain('--continue')
          expect(optionArgs).not.toContain('--approve')
        } finally {
          await home.dispose()
          if (worker !== home) {
            await worker.dispose()
          }
        }
      },
    )
  }
}

it.each(['session.launchAgent', 'session.launchAgentInMount', 'node.create'] as const)(
  '%s cannot turn a grant model value into an OpenCode continuation option',
  async id => {
    const f = await createPromptWorker({ fullAccess: false })
    try {
      const data = { provider: 'opencode', prompt: 'Explain the change', model: '--continue' }
      const result = await f.invoke({
        kind: 'command',
        id,
        payload:
          id === 'node.create'
            ? { kind: 'agent', space: { kind: 'spaceId', spaceId: 'space' }, data }
            : {
                ...(id === 'session.launchAgent' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
                ...data,
              },
      })
      expect(result).toMatchObject({ ok: true })
      expect(f.spawn.mock.calls[0][0].args).toContain('--model=--continue')
      expect(f.spawn.mock.calls[0][0].args).not.toContain('--continue')
    } finally {
      await f.dispose()
    }
  },
)
