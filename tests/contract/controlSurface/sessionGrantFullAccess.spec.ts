// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
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

for (const provider of ['claude-code', 'codex'] as const) {
  for (const route of ['node', 'direct', 'mount'] as const) {
    it.each([
      { setting: false, explicit: true, expected: true },
      { setting: true, explicit: false, expected: false },
      { setting: false, explicit: undefined, expected: false },
      { setting: true, explicit: undefined, expected: true },
    ])(
      `${route}/${provider} prepares argv with setting=$setting explicit=$explicit`,
      async ({ setting, explicit, expected }) => {
        const f = await createPromptWorker({ fullAccess: setting })
        const before = (await f.store.readAppState())!.settings
        const data = {
          provider,
          prompt: 'Explain the project',
          ...(explicit === undefined ? {} : { agentFullAccess: explicit }),
        }
        try {
          expect(
            await f.invoke({
              kind: 'command',
              id:
                route === 'node'
                  ? 'node.create'
                  : route === 'direct'
                    ? 'session.launchAgent'
                    : 'session.launchAgentInMount',
              payload:
                route === 'node'
                  ? { kind: 'agent', space: { kind: 'spaceId', spaceId: 'space' }, data }
                  : {
                      ...(route === 'direct' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
                      ...data,
                    },
            }),
          ).toMatchObject({ ok: true })
          expect(f.spawn).toHaveBeenCalledOnce()
          const flag =
            provider === 'claude-code'
              ? '--dangerously-skip-permissions'
              : '--dangerously-bypass-approvals-and-sandbox'
          expect(f.spawn.mock.calls[0][0].args.includes(flag)).toBe(expected)
          const state = (await f.store.readAppState())!
          expect(state.settings).toEqual(before)
          if (route === 'node') {
            expect(state.workspaces[0].nodes.find(node => node.kind === 'agent')?.agent).toEqual(
              expect.objectContaining(explicit === undefined ? {} : { agentFullAccess: explicit }),
            )
          }
        } finally {
          await f.dispose()
        }
      },
    )
  }
}
