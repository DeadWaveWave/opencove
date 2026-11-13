import { afterEach, describe, it, expect, vi } from 'vitest'
import { registerSessionLaunchAgentInMountHandler } from '../../../src/app/main/controlSurface/handlers/sessionLaunchAgentInMountHandler'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import { launchWorkspaceAgentSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { createAppError } from '../../../src/shared/errors/appError'
import {
  compatibilityFixture,
  context,
  absent,
  deferred,
} from './managedClaudeLaunchCompatibility.helpers'
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())
const remote = {
  mountId: 'remote-mount',
  projectId: 'workspace',
  targetId: 'remote-target',
  endpointId: 'remote',
  rootPath: '/repo',
  rootUri: 'file:///repo',
}
function fixture() {
  const f = compatibilityFixture({ enabled: true })
  const resolveMountTarget = vi.fn(async () => remote)
  const network = vi.mocked(invokeControlSurface)
  network.mockImplementation(async (_endpoint, request) => ({
    httpStatus: 200,
    result: {
      __opencoveControlEnvelope: true,
      ok: true,
      value:
        request.id === 'workspace.approveRoot'
          ? {}
          : {
              sessionId: 'remote-runtime',
              provider: 'claude-code',
              startedAt: '2026-11-11T00:00:00Z',
              resumeSessionId: 'conversation',
              effectiveModel: null,
              command: 'claude',
              args: [],
              executionContext: {
                workingDirectory: '/repo',
                projectId: 'workspace',
                spaceId: null,
              },
            },
    },
  }))
  registerSessionLaunchAgentInMountHandler(f.surface, {
    getPersistenceStore: f.getPersistenceStore,
    userDataPath: '/tmp/unused-managed-remote',
    approvedWorkspaces: {} as never,
    ptyRuntime: {
      registerRemoteSession: ({ remoteSessionId }: { remoteSessionId: string }) =>
        `home-${remoteSessionId}`,
    } as never,
    ptyStreamHub: { registerSessionMetadata: vi.fn() } as never,
    topology: {
      resolveMountTarget,
      resolveRemoteEndpointConnection: async () => ({
        hostname: 'remote',
        port: 1234,
        token: 'fixture',
      }),
    } as never,
    sessions: new Map(),
    terminalSpawnAdmission: f.admission.terminalSpawnAdmission,
    agentProviderRegistry: {} as never,
  })
  const launch = () =>
    f.surface.invoke(context, {
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        canvasNodeId: 'agent',
        workspaceId: 'workspace',
        mountId: 'remote-mount',
        prompt: 'fixture',
        provider: 'claude-code',
        intent: { kind: 'launchNew', expected: absent },
      },
    })
  return { ...f, launchRemote: launch, resolveMountTarget, network }
}
describe('remote Claude launch legacy execution', () => {
  it('allows both remote launches when the first target resolution completes last', async () => {
    const f = fixture()
    const target = deferred<typeof remote>(),
      entered = deferred<void>()
    f.resolveMountTarget.mockImplementationOnce(() => {
      entered.resolve()
      return target.promise
    })
    const first = f.launchRemote()
    await entered.promise
    try {
      expect(await f.launchRemote()).toMatchObject({ ok: true })
      target.resolve(remote)
      expect(await first).toMatchObject({ ok: true })
      expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
    } finally {
      target.resolve(remote)
      await first
      f.runtime.dispose()
    }
  })
  it('does not retry an unbranded remote failure without pre-spawn rejection evidence', async () => {
    const f = fixture()
    const implementation = f.network.getMockImplementation()!
    let launches = 0
    f.network.mockImplementation(async (endpoint, request) =>
      request.id === 'session.launchAgent' && ++launches === 1
        ? {
            httpStatus: 503,
            result: {
              __opencoveControlEnvelope: true,
              ok: false,
              error: { code: 'worker.unavailable' },
            },
          }
        : implementation(endpoint, request),
    )
    const retry = vi.fn(async () => ({ mountId: 'retry-mount', executionDirectory: '/repo' }))
    window.opencoveApi = {
      controlSurface: {
        invoke: async request => {
          const result = await f.surface.invoke(context, request)
          if (!result.ok) {
            throw createAppError(result.error)
          }
          return result.value
        },
      },
    } as typeof window.opencoveApi
    try {
      await expect(
        launchWorkspaceAgentSession({
          canvasNodeId: 'agent',
          workspaceId: 'workspace',
          mountId: 'remote-mount',
          workspacePath: '/repo',
          executionDirectory: '/repo',
          prompt: 'fixture',
          provider: 'claude-code',
          mode: 'new',
          model: null,
          mergedEnv: {},
          agentSettings: {
            agentFullAccess: false,
            codexReuseRunningAppServer: false,
            defaultTerminalProfileId: null,
          },
          launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
          retryResolveMountBinding: retry,
        }),
      ).rejects.toMatchObject({ code: 'worker.unavailable' })
      expect(launches).toBe(1)
      expect(retry).not.toHaveBeenCalled()
      expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
})

it('keeps deferred remote identity resolution outside managed admission ordering', async () => {
  const f = fixture()
  const identity = deferred<typeof f.state>(),
    entered = deferred<void>()
  f.store.readAppState.mockImplementationOnce(() => {
    entered.resolve()
    return identity.promise
  })
  const first = f.launchRemote()
  await entered.promise
  try {
    expect(await f.launchRemote()).toMatchObject({ ok: true })
    identity.resolve(f.state)
    expect(await first).toMatchObject({ ok: true })
    expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  } finally {
    identity.resolve(f.state)
    await first
    f.runtime.dispose()
  }
})

it('still rejects remote replacement of an existing owned row before forwarding', async () => {
  const f = fixture()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'owned', resumeSessionIdVerified: true },
  })
  try {
    const result = await f.surface.invoke(context, {
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        canvasNodeId: 'agent',
        workspaceId: 'workspace',
        mountId: 'remote-mount',
        provider: 'claude-code',
        prompt: 'fixture',
        intent: { kind: 'resumeCurrent' },
      },
    })
    expect(result).toMatchObject({ ok: false, error: { details: { reason: 'identityConflict' } } })
    expect(f.network).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})
