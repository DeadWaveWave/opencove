import { admittedGrantInvocation } from './admittedGrantInvocation.testUtils'
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import type { CreateAgentLaunchPlanCommand } from '../../../src/contexts/agent/application/ports/AgentProviderContribution'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const remote = vi.hoisted(() => vi.fn())
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: remote,
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
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

const routes = ['space', 'cwd', 'mount', 'space-mount', 'remote'] as const
type Route = (typeof routes)[number]
const keys = [
  'S1A_TEST_API_KEY',
  'S1A_TEST_BASE_URL',
  'S1A_TEST_DISABLED',
  'S1A_TEST_OVERLAP',
  'OPENCOVE_S1A_TEST_RESERVED',
]
function relevant(env?: Readonly<NodeJS.ProcessEnv> | null) {
  return Object.fromEntries(keys.map(key => [key, env?.[key]]))
}
async function fixture(route: Route, assertActive?: () => void) {
  keys.forEach(key => vi.stubEnv(key, undefined))
  const cwd = process.cwd(),
    rootUri = pathToFileURL(cwd).href
  const state = createMinimalState(cwd, 'project', 'space')
  state.settings = {
    defaultProvider: 'codex',
    agentFullAccess: false,
    agentEnvByProvider: {
      codex: [
        { id: 'first', key: 'S1A_TEST_API_KEY', value: 'saved-first', enabled: true },
        { id: 'last', key: 'S1A_TEST_API_KEY', value: 'saved-last', enabled: true },
        {
          id: 'url',
          key: 'S1A_TEST_BASE_URL',
          value: 'https://provider.example.invalid',
          enabled: true,
        },
        { id: 'disabled', key: 'S1A_TEST_DISABLED', value: 'must-not-apply', enabled: false },
        {
          id: 'reserved',
          key: 'OPENCOVE_S1A_TEST_RESERVED',
          value: 'must-not-apply',
          enabled: true,
        },
        { id: 'overlap', key: 'S1A_TEST_OVERLAP', value: 'saved-overlap', enabled: true },
      ],
      'claude-code': [
        { id: 'other', key: 'S1A_TEST_API_KEY', value: 'saved-claude', enabled: true },
      ],
    },
  }
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(state)
  const getPersistenceStore = vi.fn(async () => store)
  const createPlan = () =>
    vi.fn(async (_input: CreateAgentLaunchPlanCommand) => ({
      command: 'fixture-agent',
      args: [],
      env: { S1A_TEST_OVERLAP: 'managed-overlap' },
      effectiveModel: null,
      launchMode: 'new' as const,
      resumeSessionId: null,
    }))
  const plans = { codex: createPlan(), 'claude-code': createPlan() }
  const registry = new AgentProviderRegistry(
    (['codex', 'claude-code'] as const).map(id => ({
      descriptor: {
        id,
        displayName: id,
        documentationUrl: '',
        launch: { executable: 'fixture-agent', defaultArguments: [], defaultEnvironment: {} },
      },
      detector: { inspect: vi.fn() },
      launcher: { createLaunchPlan: plans[id] },
    })),
  )
  const spawn = vi.fn(async (_input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0]) => ({
    sessionId: 'child',
  }))
  const surface = createControlSurface()
  remote.mockResolvedValue({
    result: {
      ok: true,
      value: {
        sessionId: 'remote-child',
        provider: 'codex',
        startedAt: '2026-11-09T00:00:00Z',
        executionContext: { workingDirectory: cwd, projectId: null, spaceId: null },
        command: 'fixture-agent',
        args: [],
        resumeSessionId: null,
        effectiveModel: null,
      },
    },
  })
  registerSessionHandlers(surface, {
    ...createReadyTerminalAdmissionDeps(),
    agentProviderRegistry: registry,
    userDataPath: cwd,
    approvedWorkspaces: { isPathApproved: async () => true } as never,
    getPersistenceStore,
    ptyRuntime: { spawnSession: spawn, registerRemoteSession: () => 'child' } as never,
    ptyStreamHub: { registerSessionMetadata: vi.fn() } as never,
    topology: {
      listMounts: async () => ({
        mounts:
          route === 'space-mount'
            ? [{ mountId: 'mount', rootPath: cwd, rootUri, endpointId: 'local' }]
            : [],
      }),
      resolveMountTarget: async () => ({
        mountId: 'mount',
        projectId: 'project',
        targetId: 'target',
        endpointId: route === 'remote' ? 'remote' : 'local',
        rootPath: cwd,
        rootUri,
      }),
      resolveRemoteEndpointConnection: async () => ({
        baseUrl: 'http://fixture',
        token: 'test-token',
      }),
    } as never,
  })
  const { grant } = new SessionGrantRegistry(() => true).issue({
    projectId: 'project',
    spaceId: 'space',
    nodeId: 'caller',
    sessionId: 'caller-session',
  })
  const base = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const launch = (caller: 'grant' | 'bearer' | 'cookie', extra: object = {}) =>
    admittedGrantInvocation(
      surface,
      {
        ...base,
        assertActive,
        requestAuth:
          caller === 'grant'
            ? { kind: 'session-grant', grant }
            : caller === 'bearer'
              ? { kind: 'bearer' }
              : { kind: 'cookie', webSessionGeneration: 0 },
      },
      {
        kind: 'command',
        id:
          route === 'mount' || route === 'remote'
            ? 'session.launchAgentInMount'
            : 'session.launchAgent',
        payload: {
          ...(route === 'mount' || route === 'remote'
            ? { mountId: 'mount', cwdUri: rootUri }
            : route === 'cwd'
              ? { cwd }
              : { spaceId: 'space' }),
          prompt: 'Explain this project',
          ...extra,
        },
      },
    )
  return { plans, spawn, launch, getPersistenceStore }
}

it.each(['bearer', 'cookie'] as const)(
  'keeps omitted remote provider/env unchanged for %s',
  async caller => {
    const f = await fixture('remote')
    expect(await f.launch(caller)).toMatchObject({ ok: true })
    expect(remote.mock.calls.at(-1)![1].payload).toMatchObject({ provider: null, env: null })
    expect(f.getPersistenceStore).not.toHaveBeenCalled()
  },
)

it('checks caller lifetime after loading saved remote environment and before forwarding', async () => {
  let closed = false
  const f = await fixture('remote', () => {
    if (closed) {
      throw new Error('Caller ended')
    }
  })
  const load = f.getPersistenceStore.getMockImplementation()!
  f.getPersistenceStore.mockImplementationOnce(async () => {
    const store = await load()
    closed = true
    return store
  })
  expect(await f.launch('grant')).toMatchObject({ ok: false })
  expect(remote).not.toHaveBeenCalled()
  expect(f.spawn).not.toHaveBeenCalled()
})

for (const route of routes) {
  it.each([undefined, 'claude-code'] as const)(
    `resolves saved provider %s environment for grant ${route} preparation and spawn`,
    async provider => {
      const f = await fixture(route)
      const result = await f.launch('grant', provider ? { provider } : {})
      if (route === 'remote') {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: 'common.forbidden',
            details: { spawnReason: 'remote_spawning_unsupported' },
          },
        })
        expect(remote).not.toHaveBeenCalled()
        expect(f.spawn).not.toHaveBeenCalled()
        return
      }
      expect(result).toMatchObject({ ok: true })
      const selected = provider ?? 'codex'
      const expected = {
        S1A_TEST_API_KEY: selected === 'codex' ? 'saved-last' : 'saved-claude',
        S1A_TEST_BASE_URL: selected === 'codex' ? 'https://provider.example.invalid' : undefined,
        S1A_TEST_DISABLED: undefined,
        S1A_TEST_OVERLAP: selected === 'codex' ? 'saved-overlap' : undefined,
        OPENCOVE_S1A_TEST_RESERVED: undefined,
      }

      expect(f.plans[selected]).toHaveBeenCalledOnce()
      expect(relevant(f.plans[selected].mock.calls[0][0].environment)).toEqual(expected)
      expect(relevant(f.spawn.mock.calls[0][0].env)).toEqual({
        ...expected,
        S1A_TEST_OVERLAP: 'managed-overlap',
      })
      expect(JSON.stringify(result)).not.toContain('saved-last')
      expect(JSON.stringify(result)).not.toContain('saved-claude')
    },
  )
  for (const caller of ['bearer', 'cookie'] as const) {
    it.each([false, true])(
      `preserves ${caller} environment overrides=%s for ${route}`,
      async explicit => {
        const f = await fixture(route)
        const env = explicit
          ? { S1A_TEST_API_KEY: 'caller-key', S1A_TEST_OVERLAP: 'caller-overlap' }
          : undefined
        expect(
          await f.launch(caller, { provider: 'codex', ...(env ? { env } : {}) }),
        ).toMatchObject({ ok: true })
        const expected = relevant(env)
        if (route === 'remote') {
          expect(relevant(remote.mock.calls.at(-1)![1].payload.env)).toEqual(expected)
          expect(f.getPersistenceStore).not.toHaveBeenCalled()
        } else {
          expect(relevant(f.plans.codex.mock.calls[0][0].environment)).toEqual(expected)
          expect(relevant(f.spawn.mock.calls[0][0].env)).toEqual({
            ...expected,
            S1A_TEST_OVERLAP: 'managed-overlap',
          })
        }
      },
    )
  }
}
