import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_STORE_TEST_WORKSPACE_ID,
  renderHookWithCanvasStore,
} from '../../support/canvasStoreTestHarness'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { createAgentSettingsReader } from '../../support/agentSettingsReader'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { useCanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  () => ({
    buildMergedAgentLaunchEnv: vi.fn(() => ({ PROJECT_ENV: 'test' })),
    resolveAgentExecutableOverride: vi.fn(() => undefined),
    resolveWorkspaceAgentLaunchBinding: vi.fn(),
    launchWorkspaceAgentSession: vi.fn(),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)

type LauncherParams = Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]

const SPACE = {
  id: 'space-a',
  name: 'Branch',
  directoryPath: '/repo/worktree',
  targetMountId: 'mount-a',
  labelColor: null,
  nodeIds: [],
  rect: { x: 0, y: 0, width: 1000, height: 900 },
}

function fixture(): LauncherParams {
  return {
    readAgentSettings: createAgentSettingsReader({ defaultProvider: 'codex' }),
    workspaceId: 'project-a',
    workspacePath: '/repo',
    updateCanvasDocument: vi.fn(),
    onShowMessage: vi.fn(),
    createNodeForSession: vi.fn(async input => ({
      id: 'new-agent',
      position: input.anchor,
      data: {
        sessionId: input.sessionId,
        title: input.title,
        kind: 'agent',
        width: 600,
        height: 400,
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        agent: input.agent ?? null,
        task: null,
        note: null,
        image: null,
        document: null,
        website: null,
      },
    })),
    buildAgentNodeTitle: vi.fn(provider => `${provider} · new`),
  }
}

describe('shared Agent launcher entrypoints', () => {
  let harness: ReturnType<typeof createCanvasDocumentHarness>

  beforeEach(() => {
    vi.clearAllMocks()
    // The launcher reads the Space under the anchor from the document of its workspace.
    harness = createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      spaces: [SPACE],
    })
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockResolvedValue({
      mountId: 'mount-a',
      executionDirectory: '/repo/worktree',
    })
    vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
      sessionId: 'session-a',
      resumeSessionId: null,
      profileId: 'profile-a',
      runtimeKind: 'posix',
      effectiveModel: null,
      executionDirectory: '/repo/worktree',
      workerBinding: { endpointId: 'local', mountId: 'mount-a' },
    })
  })

  it('carries the managed receipt into node placement', async () => {
    const params = fixture()
    const binding = {
      nodeId: 'agent',
      activationId: 'owned',
      runtimeSessionId: 'session-a',
      tuple: { resumeSessionId: 'owned', resumeSessionIdVerified: true },
      nodeSeen: false,
      bindingRevision: 0,
      observedRevision: 0,
    }
    const receipt = { binding, commitRevision: null }
    vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
      sessionId: 'session-a',
      resumeSessionId: 'owned',
      profileId: null,
      effectiveModel: null,
      executionDirectory: '/repo',
      managedClaudeLifecycle: receipt,
    })
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(params.createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({ managedClaudeLifecycle: receipt }),
    )
  })

  it('uses the same default provider, mount, directory and node placement without a context menu', async () => {
    const params = fixture()
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'project-a',
        currentMountId: 'mount-a',
        executionDirectory: '/repo/worktree',
        targetSpace: SPACE,
      }),
    )
    const bindingOptions = vi.mocked(resolveWorkspaceAgentLaunchBinding).mock.calls[0][0]
    expect(bindingOptions.updateSpaces).toEqual(expect.any(Function))
    for (const channel of ['spacesRef', 'onSpacesChange', 'onRequestPersistFlush']) {
      expect(bindingOptions).not.toHaveProperty(channel)
    }
    expect(launchWorkspaceAgentSession).toHaveBeenCalledTimes(1)
    expect(launchWorkspaceAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        mode: 'new',
        prompt: '',
        mountId: 'mount-a',
        executionDirectory: '/repo/worktree',
      }),
    )
    expect(params.createNodeForSession).toHaveBeenCalledTimes(1)
    expect(params.createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-a',
        kind: 'agent',
        placement: { targetSpaceRect: SPACE.rect },
        agent: expect.objectContaining({ provider: 'codex', directoryMode: 'workspace' }),
      }),
    )
    expect(assignNodeToSpaceAndExpand).toHaveBeenCalledWith(
      expect.objectContaining({
        createdNodeId: 'new-agent',
        targetSpaceId: 'space-a',
        updateCanvasDocument: params.updateCanvasDocument,
      }),
    )
    const assignOptions = vi.mocked(assignNodeToSpaceAndExpand).mock.calls[0][0]
    for (const channel of ['spacesRef', 'nodesRef', 'setNodes', 'onSpacesChange']) {
      expect(assignOptions).not.toHaveProperty(channel)
    }
  })

  it('requests no flush of its own between the binding and the node add', async () => {
    const params = fixture()
    const flushesAtNodeAdd: number[] = []
    const createNodeForSession = params.createNodeForSession
    params.createNodeForSession = vi.fn(async input => {
      flushesAtNodeAdd.push(harness.flush.mock.calls.length)
      return await createNodeForSession(input)
    })
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(flushesAtNodeAdd).toEqual([0])
  })

  it('flushes once, after the node is assigned to its Space', async () => {
    const params = fixture()
    const order: string[] = []
    vi.mocked(assignNodeToSpaceAndExpand).mockImplementation(() => {
      order.push('assign')
    })
    harness.flush.mockImplementation(() => {
      order.push('flush')
    })
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(order).toEqual(['assign', 'flush'])
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('does not flush for an agent launched outside every Space', async () => {
    const params = fixture()
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 5000, y: 5000 }))
    expect(params.createNodeForSession).toHaveBeenCalledTimes(1)
    expect(assignNodeToSpaceAndExpand).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('reads the Space under the anchor from the document, as the same call wrote it', async () => {
    const params = fixture()
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(async () => {
      replaceSpacesInStore(CANVAS_STORE_TEST_WORKSPACE_ID, [
        { ...SPACE, id: 'space-late', rect: { x: 2000, y: 2000, width: 500, height: 500 } },
      ])
      await result.current.launchAgentAtFlowPosition({ x: 2100, y: 2100 })
    })
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenCalledWith(
      expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-late' }) }),
    )
  })

  it('reads the Space under the anchor from its own workspace while another is displayed', async () => {
    const params = fixture()
    useAppStore.setState(state => ({
      workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'other', spaces: [] }],
      activeWorkspaceId: 'other',
    }))
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenCalledWith(
      expect.objectContaining({ targetSpace: SPACE }),
    )
  })

  it('gives the retry binding the same writer and none of the old channels', async () => {
    const params = fixture()
    vi.mocked(launchWorkspaceAgentSession).mockImplementationOnce(async options => {
      await options.retryResolveMountBinding?.('mount-failed')
      return {
        sessionId: 'session-a',
        resumeSessionId: null,
        profileId: null,
        effectiveModel: null,
        executionDirectory: '/repo/worktree',
        workerBinding: { endpointId: 'local', mountId: 'mount-a' },
      } as never
    })
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    const calls = vi
      .mocked(resolveWorkspaceAgentLaunchBinding)
      .mock.calls.map(([options]) => options)
    expect(calls).toHaveLength(2)
    expect(calls[1].updateSpaces).toBe(calls[0].updateSpaces)
    for (const channel of ['spacesRef', 'onSpacesChange', 'onRequestPersistFlush']) {
      expect(calls[1]).not.toHaveProperty(channel)
    }
  })

  it('prevents concurrent menu and keyboard launches while mount resolution is pending', async () => {
    const params = fixture()
    let resolveMount!: (
      value: Awaited<ReturnType<typeof resolveWorkspaceAgentLaunchBinding>>,
    ) => void
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveMount = resolve
        }),
    )
    const paneMenu = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const
    const { result, readUi, commands } = renderHookWithCanvasStore(
      () => useWorkspaceCanvasAgentLauncher(params),
      { contextMenu: paneMenu },
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.launchAgentAtFlowPosition({ x: 400, y: 300 })
      result.current.openAgentLauncher()
      void result.current.launchAgentAtFlowPosition({ x: 420, y: 320 })
    })
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveMount({ mountId: 'mount-a', executionDirectory: '/repo/worktree' })
      await pending
    })
    expect(launchWorkspaceAgentSession).toHaveBeenCalledTimes(1)
    expect(params.createNodeForSession).toHaveBeenCalledTimes(1)
    // The first launch closed the pane menu, so the explicit retry opens it again.
    act(() => commands.openContextMenu(paneMenu))
    act(() => result.current.openAgentLauncherForProvider('claude-code'))
    await waitFor(() => expect(params.createNodeForSession).toHaveBeenCalledTimes(2))
    expect(launchWorkspaceAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'claude-code',
      }),
    )
    expect(readUi().contextMenu).toBeNull()
  })

  it('releases the launch guard after a failure so an explicit retry can run', async () => {
    const params = fixture()
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(params.onShowMessage).toHaveBeenCalledWith(expect.stringContaining('Offline'), 'error')
    expect(launchWorkspaceAgentSession).not.toHaveBeenCalled()
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(launchWorkspaceAgentSession).toHaveBeenCalledTimes(1)
    expect(params.createNodeForSession).toHaveBeenCalledTimes(1)
  })

  it.each(['claude-code', 'codex'] as const)(
    'persists only an authoritative new session binding for %s',
    async provider => {
      const params = fixture()
      vi.mocked(launchWorkspaceAgentSession).mockResolvedValueOnce({
        sessionId: 'runtime-a',
        resumeSessionId: 'assigned-session-a',
        profileId: null,
        runtimeKind: 'posix',
        effectiveModel: null,
        executionDirectory: '/repo/worktree',
        workerBinding: { endpointId: 'local', mountId: 'mount-a' },
      })
      const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
      await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }, provider))
      expect(params.createNodeForSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({
            resumeSessionId: provider === 'claude-code' ? 'assigned-session-a' : null,
            resumeSessionIdVerified: provider === 'claude-code',
          }),
        }),
      )
    },
  )
})

// S7 of #647, PR 5 (review round): the launcher reads the settings when a launch starts. A reader
// whose answer changes after the render, with no render between, must be honoured (R01, R02).
describe('the agent launcher reads the settings when a launch starts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createCanvasDocumentHarness({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID, spaces: [SPACE] })
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockResolvedValue({
      mountId: 'mount-a',
      executionDirectory: '/repo/worktree',
    })
    vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
      sessionId: 'session-a',
      resumeSessionId: null,
      profileId: 'profile-a',
      runtimeKind: 'posix',
      effectiveModel: null,
      executionDirectory: '/repo/worktree',
      workerBinding: { endpointId: 'local', mountId: 'mount-a' },
    })
  })

  function mutableReader(initial: Partial<AgentSettings>) {
    let settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, ...initial }
    return {
      read: () => settings,
      set: (patch: Partial<AgentSettings>) => {
        settings = { ...settings, ...patch }
      },
    }
  }

  it('launches the default provider and window size of the settings at the call', async () => {
    const reader = mutableReader({ defaultProvider: 'codex', standardWindowSizeBucket: 'regular' })
    const params = { ...fixture(), readAgentSettings: reader.read }
    const { result } = renderHookWithCanvasStore(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    const first = vi.mocked(launchWorkspaceAgentSession).mock.calls[0]![0] as {
      launchGeometry: { frameSize: { width: number } }
    }

    reader.set({ defaultProvider: 'claude-code', standardWindowSizeBucket: 'large' })
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))

    const second = vi.mocked(launchWorkspaceAgentSession).mock.calls[1]![0] as {
      provider: string
      launchGeometry: { frameSize: { width: number } }
    }
    expect(second.provider).toBe('claude-code')
    expect(second.launchGeometry.frameSize.width).toBeGreaterThan(
      first.launchGeometry.frameSize.width,
    )
  })

  it('opens the launcher for the default provider of the settings at the call', async () => {
    const reader = mutableReader({ defaultProvider: 'codex' })
    const params = { ...fixture(), readAgentSettings: reader.read }
    const { result } = renderHookWithCanvasStore(() => ({
      launcher: useWorkspaceCanvasAgentLauncher(params),
      ui: useCanvasUiCommands(),
    }))

    reader.set({ defaultProvider: 'claude-code' })
    act(() =>
      result.current.ui.openContextMenu({ kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 }),
    )
    await act(async () => {
      result.current.launcher.openAgentLauncher()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(vi.mocked(launchWorkspaceAgentSession)).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude-code' }),
    )
  })
})
