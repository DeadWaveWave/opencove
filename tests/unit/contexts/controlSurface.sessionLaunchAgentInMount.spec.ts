import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

const resolveWorkerAgentTestStubMock = vi.hoisted(() => vi.fn())
const { captureGeminiSessionDiscoveryCursorMock } = vi.hoisted(() => ({
  captureGeminiSessionDiscoveryCursorMock: vi.fn(),
}))
const { invokeControlSurfaceMock } = vi.hoisted(() => ({
  invokeControlSurfaceMock: vi.fn(),
}))

vi.mock('../../../src/app/main/controlSurface/handlers/sessionAgentTestStub', () => ({
  resolveWorkerAgentTestStub: resolveWorkerAgentTestStubMock,
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocatorProviders', () => ({
  captureGeminiSessionDiscoveryCursor: captureGeminiSessionDiscoveryCursorMock,
}))

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: invokeControlSurfaceMock,
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
    },
  },
}

afterEach(() => {
  resolveWorkerAgentTestStubMock.mockReset()
  captureGeminiSessionDiscoveryCursorMock.mockReset()
  invokeControlSurfaceMock.mockReset()
  vi.clearAllMocks()
})

describe('control surface session.launchAgentInMount', () => {
  it('passes executable overrides through remote mounted agent launches', async () => {
    const rootPath = process.cwd()
    const rootUri = pathToFileURL(rootPath).href
    const registerRemoteSession = vi.fn(() => 'home-session-override')
    const registerSessionMetadata = vi.fn()

    invokeControlSurfaceMock
      .mockResolvedValueOnce({
        result: {
          ok: true,
          value: undefined,
        },
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          value: {
            sessionId: 'remote-session-override',
            provider: 'codex',
            startedAt: '2026-03-27T00:00:00.000Z',
            executionContext: {
              projectId: null,
              spaceId: null,
              mountId: null,
              targetId: null,
              endpoint: { endpointId: 'remote-worker-1', kind: 'remote_worker' },
              target: { scheme: 'file', rootPath, rootUri },
              scope: { rootPath, rootUri },
              workingDirectory: rootPath,
            },
            profileId: null,
            runtimeKind: 'windows',
            resumeSessionId: null,
            effectiveModel: 'gpt-5.2-codex',
            command: 'codex',
            args: ['--dangerously-bypass-approvals-and-sandbox'],
          },
        },
      })

    const controlSurface = createControlSurface()
    registerSessionHandlers(controlSurface, {
      userDataPath: '/tmp/opencove-test-user-data',
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () =>
        ({
          readAppState: async () => ({ settings: {} }),
        }) as never,
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused-local-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        registerRemoteSession,
        dispose: () => undefined,
      },
      ptyStreamHub: {
        registerSessionMetadata,
        hasSession: () => false,
      } as unknown as PtyStreamHub,
      topology: {
        resolveMountTarget: async () => ({
          mountId: 'mount-remote',
          targetId: 'target-remote',
          endpointId: 'remote-worker-1',
          rootPath,
          rootUri,
        }),
        resolveRemoteEndpointConnection: async () => ({
          baseUrl: 'http://127.0.0.1:7777',
          token: 'token',
        }),
      } as never,
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        mountId: 'mount-remote',
        cwdUri: rootUri,
        prompt: '',
        provider: 'codex',
        mode: 'new',
        model: 'gpt-5.2-codex',
        executablePathOverride: 'E:\\node-v22.17.0-win-x64\\node_global\\codex.cmd',
        cols: 132,
        rows: 41,
      },
    })

    expect(launched.ok).toBe(true)
    expect(registerRemoteSession).toHaveBeenCalledWith({
      endpointId: 'remote-worker-1',
      remoteSessionId: 'remote-session-override',
    })
    expect(registerSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'home-session-override',
        cols: 132,
        rows: 41,
      }),
    )
    expect(invokeControlSurfaceMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        id: 'session.launchAgent',
        payload: expect.objectContaining({
          executablePathOverride: 'E:\\node-v22.17.0-win-x64\\node_global\\codex.cmd',
          cols: 132,
          rows: 41,
        }),
      }),
    )
  })

  it('passes resumeSessionId through local mounted test agent resume launches', async () => {
    const expectedRuntimeKind = process.platform === 'win32' ? 'windows' : 'posix'
    const rootPath = process.cwd()
    const rootUri = pathToFileURL(rootPath).href
    const spawnSession = vi.fn(async () => ({ sessionId: 'pty-mounted-resume' }))

    resolveWorkerAgentTestStubMock.mockImplementation(options => ({
      command: 'node',
      args: ['stub-agent', options.resumeSessionId ?? 'missing-resume-session'],
    }))

    const controlSurface = createControlSurface()
    registerSessionHandlers(controlSurface, {
      userDataPath: '/tmp/opencove-test-user-data',
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () =>
        ({
          readAppState: async () => ({ settings: {} }),
        }) as never,
      ptyRuntime: {
        spawnSession,
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        registerRemoteSession: () => 'remote-home-session',
        dispose: () => undefined,
      },
      ptyStreamHub: {
        registerSessionMetadata: () => undefined,
        hasSession: () => false,
      } as unknown as PtyStreamHub,
      topology: {
        resolveMountTarget: async () => ({
          mountId: 'mount-local',
          targetId: 'target-local',
          endpointId: 'local',
          rootPath,
          rootUri,
        }),
      } as never,
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        mountId: 'mount-local',
        cwdUri: rootUri,
        prompt: '',
        provider: 'codex',
        mode: 'resume',
        model: 'gpt-5.2-codex',
        resumeSessionId: 'resume-session-123',
      },
    })

    expect(launched.ok).toBe(true)
    expect(launched.value).toMatchObject({
      profileId: process.platform === 'win32' ? 'powershell' : null,
      runtimeKind: expectedRuntimeKind,
    })
    expect(resolveWorkerAgentTestStubMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'resume',
        resumeSessionId: 'resume-session-123',
      }),
    )
    const spawnedInput = spawnSession.mock.calls[0]?.[0]
    expect(spawnedInput).toEqual(
      expect.objectContaining({
        command: expect.any(String),
        args: expect.any(Array),
      }),
    )
    expect(spawnedInput?.args.join('\n')).toContain('stub-agent')
    expect(spawnedInput?.args.join('\n')).toContain('resume-session-123')
  })

  it('captures the Gemini discovery cursor before starting the mount watcher for new launches', async () => {
    const previousFlag = process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
    process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = '1'

    try {
      const rootPath = process.cwd()
      const rootUri = pathToFileURL(rootPath).href
      const startSessionStateWatcher = vi.fn()

      captureGeminiSessionDiscoveryCursorMock.mockResolvedValue({
        entriesByFilePath: {
          [`${rootPath}/.gemini/chats/session-existing.json`]: {
            signature: 'existing-signature',
            hadRelevantTurn: true,
          },
        },
      })
      resolveWorkerAgentTestStubMock.mockReturnValue({
        command: 'node',
        args: ['stub-agent'],
      })

      const controlSurface = createControlSurface()
      registerSessionHandlers(controlSurface, {
        userDataPath: '/tmp/opencove-test-user-data',
        approvedWorkspaces: {
          registerRoot: async () => undefined,
          isPathApproved: async () => true,
        },
        getPersistenceStore: async () =>
          ({
            readAppState: async () => ({ settings: {} }),
          }) as never,
        ptyRuntime: {
          spawnSession: async () => ({ sessionId: 'pty-mounted-gemini' }),
          write: () => undefined,
          resize: () => undefined,
          kill: () => undefined,
          onData: () => () => undefined,
          onExit: () => () => undefined,
          attach: () => undefined,
          detach: () => undefined,
          snapshot: () => '',
          startSessionStateWatcher,
          registerRemoteSession: () => 'remote-home-session',
          dispose: () => undefined,
        },
        ptyStreamHub: {
          registerSessionMetadata: () => undefined,
          hasSession: () => false,
        } as unknown as PtyStreamHub,
        topology: {
          resolveMountTarget: async () => ({
            mountId: 'mount-local',
            targetId: 'target-local',
            endpointId: 'local',
            rootPath,
            rootUri,
          }),
        } as never,
      })

      const launched = await controlSurface.invoke(ctx, {
        kind: 'command',
        id: 'session.launchAgentInMount',
        payload: {
          mountId: 'mount-local',
          cwdUri: rootUri,
          prompt: '',
          provider: 'gemini',
          mode: 'new',
          model: 'gemini-3-flash-preview',
        },
      })

      expect(launched.ok).toBe(true)
      expect(captureGeminiSessionDiscoveryCursorMock).toHaveBeenCalledWith(rootPath)
      expect(startSessionStateWatcher).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'pty-mounted-gemini',
          provider: 'gemini',
          geminiDiscoveryCursor: {
            entriesByFilePath: {
              [`${rootPath}/.gemini/chats/session-existing.json`]: {
                signature: 'existing-signature',
                hadRelevantTurn: true,
              },
            },
          },
        }),
      )
    } finally {
      if (previousFlag === undefined) {
        delete process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
      } else {
        process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = previousFlag
      }
    }
  })
})
