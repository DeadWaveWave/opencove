import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexSessionFileDiscovery } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFileDiscovery'

afterEach(() => {
  vi.resetModules()
})

describe('registerControlSurfaceServer composition', () => {
  it('injects the app-main process engine into the owned local PTY runtime', async () => {
    const processEngine = { kind: 'injected-process-engine' }
    const ptyRuntime = { dispose: vi.fn() }
    const createMainTerminalProcessEngine = vi.fn(() => processEngine)
    const createPtyRuntime = vi.fn((_options: unknown) => ptyRuntime)
    const createBuiltinAgentProviderContributions = vi.fn(() => [])
    const registerControlSurfaceHttpServer = vi.fn(() => ({
      ready: Promise.resolve({}),
      dispose: vi.fn(),
    }))

    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-user-data') },
      shell: { trashItem: vi.fn() },
      webContents: { getAllWebContents: () => [] },
    }))
    vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/runtime', () => ({
      createPtyRuntime,
    }))
    vi.doMock('../../../src/app/main/terminal/mainTerminalProcessEngineFactory', () => ({
      createMainTerminalProcessEngine,
    }))
    vi.doMock('../../../src/app/main/controlSurface/controlSurfaceHttpServer', () => ({
      registerControlSurfaceHttpServer,
    }))
    vi.doMock(
      '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore',
      () => ({
        createApprovedWorkspaceStore: vi.fn(() => ({})),
      }),
    )
    vi.doMock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
      readRuntimeAppVersion: () => 'test-version',
    }))
    vi.doMock('../../../src/app/main/controlSurface/agentHook/claudeHookChannel', () => ({
      createClaudeHookChannel: () => ({ provider: 'claude-code' }),
    }))
    vi.doMock('../../../src/app/main/controlSurface/agentHook/codexHookChannel', () => ({
      createCodexHookChannel: () => ({ provider: 'codex' }),
    }))
    vi.doMock('../../../src/contexts/agent/application/services/AgentProviderRegistry', () => ({
      AgentProviderRegistry: vi.fn(),
    }))
    vi.doMock(
      '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog',
      () => ({
        createBuiltinAgentProviderContributions,
      }),
    )
    vi.doMock('../../../src/app/main/websiteWindow/websiteWindowManagerRegistry', () => ({
      closeWebsiteWindowNodeAcrossManagers: vi.fn(),
    }))

    const { registerControlSurfaceServer } =
      await import('../../../src/app/main/controlSurface/registerControlSurfaceServer')
    registerControlSurfaceServer()

    expect(createMainTerminalProcessEngine).toHaveBeenCalledTimes(1)
    expect(createPtyRuntime).toHaveBeenCalledWith({
      processEngine,
      sessionDiscovery: expect.any(CodexSessionFileDiscovery),
    })
    const { sessionDiscovery } = createPtyRuntime.mock.calls[0][0] as { sessionDiscovery: unknown }
    expect(createBuiltinAgentProviderContributions).toHaveBeenCalledWith(
      expect.objectContaining({
        codexSessionDiscovery: sessionDiscovery,
      }),
    )
    expect(registerControlSurfaceHttpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        userDataPath: '/tmp/opencove-user-data',
        ptyRuntime,
        ownsPtyRuntime: true,
      }),
    )
  })
})
