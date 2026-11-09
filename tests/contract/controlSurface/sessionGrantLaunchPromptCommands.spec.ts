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

const routes = ['direct', 'direct-space', 'mount', 'node', 'remote', 'remote-node'] as const
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

const inputs = {
  'claude-code': [
    '! printenv X',
    '/permissions',
    '  /approvals',
    '/permissions change policy',
    '# note',
    '& task',
  ],
  codex: ['! printenv X', '/permissions', '  /approvals', '/approvals change policy'],
  opencode: ['! printenv X', '/permissions change policy'],
  pi: ['! printenv X', '!! printenv X', '/settings change policy'],
  kimi: ['/yolo on'],
  gemini: ['! printenv X', '/approvals change policy'],
}
for (const route of routes) {
  for (const provider of AGENT_PROVIDER_IDS) {
    it.each(inputs[provider])(
      `${route}/${provider} refuses TUI prompt %j before preparation, spawn or remote forwarding`,
      async prompt => {
        const f = await createPromptWorker({
          remote: route.startsWith('remote'),
          fullAccess: provider === 'kimi',
        })
        const before = await f.store.readAppState()
        try {
          expect(await f.invoke(request(route, { provider, prompt }))).toMatchObject({
            ok: false,
            error: {
              code: 'common.forbidden',
              details: {
                reason: 'field_denied',
                field: 'prompt',
                promptReason: 'provider_command_prefix',
              },
            },
          })
          expect(f.spawn).not.toHaveBeenCalled()
          expect(remote).not.toHaveBeenCalled()
          expect(f.kill).not.toHaveBeenCalled()
          expect(await f.store.readAppState()).toEqual(before)
          expect(f.hub.listSessions().sessions).toEqual([])
        } finally {
          await f.dispose()
        }
      },
    )
  }
}
for (const provider of AGENT_PROVIDER_IDS) {
  it.each([
    'Review the change',
    'Explain ! printenv X',
    'Explain /permissions',
    ...(provider !== 'claude-code' ? ['# note'] : []),
    ...(provider === 'kimi' ? ['! printenv X'] : []),
  ])(`${provider} admits plain launch text %j`, async prompt => {
    const f = await createPromptWorker({ fullAccess: provider === 'kimi' })
    try {
      expect(await f.invoke(request('direct', { provider, prompt }))).toMatchObject({ ok: true })
      expect(f.spawn).toHaveBeenCalledOnce()
    } finally {
      await f.dispose()
    }
  })
}
it.each([{}, { provider: null }, { provider: ' ' }, { provider: 'gemini' }])(
  'uses configured Claude rather than requested provider %j',
  async input => {
    const f = await createPromptWorker({ remote: true, fullAccess: false })
    try {
      const before = (await f.store.readAppState())!
      await f.store.writeAppState({
        ...before,
        settings: { defaultProvider: 'claude-code', agentFullAccess: false },
      })
      expect(await f.invoke(request('remote', { ...input, prompt: '# note' }))).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: {
            reason: 'field_denied',
            field: 'prompt',
            promptReason: 'provider_command_prefix',
          },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
      expect(remote).not.toHaveBeenCalled()
    } finally {
      await f.dispose()
    }
  },
)
for (const provider of ['claude-code', 'codex', 'pi'] as const) {
  for (const route of ['direct', 'mount', 'node'] as const) {
    it.each(inputs[provider])(
      `${route}/${provider} preserves trusted TUI prompt %j`,
      async prompt => {
        const f = await createPromptWorker({ fullAccess: false })
        try {
          expect(await f.invoke(request(route, { provider, prompt }), true)).toMatchObject({
            ok: true,
          })
          expect(f.spawn).toHaveBeenCalledOnce()
        } finally {
          await f.dispose()
        }
      },
    )
  }
}

for (const route of routes) {
  it.each([
    '\u0085/plan off',
    '\u001c/plan off',
    '\u001d/plan off',
    '\u001e/plan off',
    '\u001f/plan off',
    '\u2003/plan off',
  ])(`${route} refuses Python/Rust whitespace before a Kimi command %j`, async prompt => {
    const f = await createPromptWorker({ remote: route.startsWith('remote'), fullAccess: true })
    try {
      expect(await f.invoke(request(route, { provider: 'kimi', prompt }))).toMatchObject({
        ok: false,
        error: {
          code: 'common.forbidden',
          details: {
            reason: 'field_denied',
            promptReason: 'provider_command_prefix',
            field: 'prompt',
          },
        },
      })
      expect(f.spawn).not.toHaveBeenCalled()
      expect(remote).not.toHaveBeenCalled()
    } finally {
      await f.dispose()
    }
  })
}
