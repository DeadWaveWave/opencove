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
afterEach(() => vi.clearAllMocks())

const routes = [
  'direct',
  'direct-space',
  'mount',
  'node',
  'mounted-node',
  'remote',
  'remote-node',
] as const
function request(route: (typeof routes)[number], data: object) {
  const node = route.endsWith('node')
  return {
    kind: 'command' as const,
    id: node
      ? 'node.create'
      : route.startsWith('direct')
        ? 'session.launchAgent'
        : 'session.launchAgentInMount',
    payload: node
      ? { kind: 'agent', space: { kind: 'spaceId', spaceId: 'space' }, data }
      : {
          ...(route === 'direct-space'
            ? { spaceId: 'space' }
            : route === 'direct'
              ? { cwd }
              : { mountId: 'mount', cwdUri: rootUri }),
          ...data,
        },
  }
}
const message =
  'A one-word prompt can be read as a provider command; describe the task in a sentence.'
for (const route of routes) {
  for (const provider of AGENT_PROVIDER_IDS) {
    it.each(['logout', 'update', 'resume', 'Refactor'])(
      `${route}/${provider} refuses single-token %j before launch or bearer forwarding`,
      async prompt => {
        const f = await createPromptWorker({
          remote: route.startsWith('remote'),
          localMount: route === 'mounted-node',
          fullAccess: false,
        })
        const before = await f.store.readAppState()
        try {
          const result = await f.invoke(request(route, { provider, prompt: ` \t${prompt}\n ` }))
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'common.forbidden',
              ...(route === 'remote-node'
                ? { details: { spawnReason: 'remote_spawning_unsupported' } }
                : { details: { reason: 'field_denied', field: 'prompt', message } }),
            },
          })
          expect(f.spawn).not.toHaveBeenCalled()
          expect(remote).not.toHaveBeenCalled()
          expect(f.kill).not.toHaveBeenCalled()
          expect(f.hub.listSessions().sessions).toEqual([])
          expect(await f.store.readAppState()).toEqual(before)
        } finally {
          await f.dispose()
        }
      },
    )
  }
}
it.each(['--continue', '--approve', '-p', '@input.txt', '退出', 'Refactor!', '\u00a0logout\u00a0'])(
  'refuses token %j with the same policy when provider is omitted',
  async prompt => {
    const f = await createPromptWorker({ fullAccess: false })
    try {
      expect(await f.invoke(request('direct', { prompt }))).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: { reason: 'field_denied', field: 'prompt', message },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
    } finally {
      await f.dispose()
    }
  },
)
it.each([
  'logout now',
  'update\tproject',
  'resume\nthe task',
  'Refactor\u00a0code',
  '--continue this task',
  '',
  ' \t\n ',
])('admits multi-word or empty prompt %j without splitting argv', async prompt => {
  const f = await createPromptWorker({ fullAccess: false })
  try {
    expect(await f.invoke(request('direct', { provider: 'codex', prompt }))).toMatchObject({
      ok: true,
    })
    const args = f.spawn.mock.calls[0][0].args
    if (prompt.trim()) {
      expect(args.at(-1)).toBe(prompt.trim())
    }
    expect(f.spawn).toHaveBeenCalledOnce()
  } finally {
    await f.dispose()
  }
})
for (const route of ['direct', 'mount', 'node'] as const) {
  it.each(['logout', 'update', 'resume', 'Refactor'])(
    `${route} preserves trusted Claude single-word %j admission`,
    async prompt => {
      const f = await createPromptWorker({ fullAccess: false })
      try {
        expect(
          await f.invoke(request(route, { provider: 'claude-code', prompt }), true),
        ).toMatchObject({ ok: true })
        expect(f.spawn.mock.calls[0][0].args.at(-1)).toBe(prompt)
        expect(f.spawn).toHaveBeenCalledOnce()
      } finally {
        await f.dispose()
      }
    },
  )
}
