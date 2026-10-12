import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { LaunchAgentSessionResult } from '../../../src/shared/contracts/dto'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'

const { resolveWorkerAgentTestStub, invokeControlSurface } = vi.hoisted(() => ({
  resolveWorkerAgentTestStub: vi.fn(() => null),
  invokeControlSurface: vi.fn(),
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock('../../../src/app/main/controlSurface/handlers/sessionAgentTestStub', () => ({
  resolveWorkerAgentTestStub,
}))

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface,
}))

const ctx = { now: () => new Date('2026-10-12T00:00:00Z') } as ControlSurfaceContext
const assignedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('managed Claude launch session binding', () => {
  it.each(['plain', 'mount', 'remote'] as const)(
    'preserves the assigned session through the %s launch response, record and watcher',
    async route => {
      vi.stubEnv('OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER', '1')
      const cwd = process.cwd()
      const rootUri = pathToFileURL(cwd).href
      const registry = createTestAgentProviderRegistry()
      const plan = vi
        .spyOn(registry.require('claude-code').launcher, 'createLaunchPlan')
        .mockResolvedValue({
          command: 'claude',
          args: ['--session-id', assignedId],
          env: {},
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: assignedId,
        })
      const spawnSession = vi.fn(async () => ({ sessionId: 'runtime-a' }))
      const startSessionStateWatcher = vi.fn()
      invokeControlSurface.mockResolvedValue({
        result: {
          ok: true,
          value: {
            sessionId: 'remote-runtime-a',
            provider: 'claude-code',
            resumeSessionId: assignedId,
            startedAt: '2026-10-12T00:00:00Z',
            command: 'claude',
            args: ['--session-id', assignedId],
            executionContext: { workingDirectory: cwd, projectId: null, spaceId: null },
            effectiveModel: null,
          },
        },
      })
      const controlSurface = createControlSurface()
      registerSessionHandlers(controlSurface, {
        ...createReadyTerminalAdmissionDeps(),
        agentProviderRegistry: registry,
        userDataPath: '/tmp/opencove-test-user-data',
        approvedWorkspaces: { isPathApproved: async () => true } as never,
        getPersistenceStore: async () =>
          ({ readAppState: async () => ({ settings: {} }) }) as never,
        ptyRuntime: {
          spawnSession,
          startSessionStateWatcher,
          registerRemoteSession: () => 'runtime-a',
        } as never,
        ptyStreamHub: { registerSessionMetadata: vi.fn() } as never,
        topology: {
          resolveMountTarget: async () => ({
            mountId: 'mount-a',
            projectId: 'project-a',
            targetId: 'target-a',
            endpointId: route === 'remote' ? 'endpoint-remote' : 'local',
            rootPath: cwd,
            rootUri,
          }),
          resolveRemoteEndpointConnection: async () => ({
            baseUrl: 'http://127.0.0.1:7777',
            token: 'fixture',
          }),
        } as never,
      })

      const result = await controlSurface.invoke<LaunchAgentSessionResult>(ctx, {
        kind: 'command',
        id: route !== 'plain' ? 'session.launchAgentInMount' : 'session.launchAgent',
        payload: {
          ...(route !== 'plain' ? { mountId: 'mount-a', cwdUri: rootUri } : { cwd }),
          provider: 'claude-code',
          mode: 'new',
          prompt: '',
          resumeSessionId: null,
        },
      })
      expect(result).toMatchObject({ ok: true, value: { resumeSessionId: assignedId } })
      if (route === 'remote') {
        expect(plan).not.toHaveBeenCalled()
        expect(spawnSession).not.toHaveBeenCalled()
        expect(invokeControlSurface).toHaveBeenLastCalledWith(
          expect.any(Object),
          expect.objectContaining({
            id: 'session.launchAgent',
            payload: expect.objectContaining({ mode: 'new', resumeSessionId: null }),
          }),
        )
      } else {
        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: null }))
        expect(resolveWorkerAgentTestStub).toHaveBeenCalledWith(
          expect.objectContaining({ mode: 'new', resumeSessionId: assignedId }),
        )
        expect(spawnSession).toHaveBeenCalledWith(
          expect.objectContaining({ args: ['--session-id', assignedId] }),
        )
        expect(startSessionStateWatcher).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 'runtime-a', resumeSessionId: assignedId }),
        )
      }
      const record = await controlSurface.invoke(ctx, {
        kind: 'query',
        id: 'session.get',
        payload: { sessionId: 'runtime-a' },
      })
      expect(record).toMatchObject({ ok: true, value: { resumeSessionId: assignedId } })
    },
  )
})
