import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'

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

function fixture(): LauncherParams {
  return {
    agentSettings: { ...DEFAULT_AGENT_SETTINGS, defaultProvider: 'codex' },
    workspaceId: 'project-a',
    workspacePath: '/repo',
    nodesRef: { current: [] },
    setNodes: vi.fn(),
    spacesRef: {
      current: [
        {
          id: 'space-a',
          name: 'Branch',
          directoryPath: '/repo/worktree',
          targetMountId: 'mount-a',
          labelColor: null,
          nodeIds: [],
          rect: { x: 0, y: 0, width: 1000, height: 900 },
        },
      ],
    },
    onSpacesChange: vi.fn(),
    onRequestPersistFlush: vi.fn(),
    onShowMessage: vi.fn(),
    contextMenu: null,
    setContextMenu: vi.fn(),
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
    standardWindowSizeBucket: DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
    buildAgentNodeTitle: vi.fn(provider => `${provider} · new`),
  }
}

describe('shared Agent launcher entrypoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockResolvedValue({
      mountId: 'mount-a',
      executionDirectory: '/repo/worktree',
    })
    vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
      sessionId: 'session-a',
      profileId: 'profile-a',
      runtimeKind: 'posix',
      effectiveModel: null,
      executionDirectory: '/repo/worktree',
      workerBinding: { endpointId: 'local', mountId: 'mount-a' },
    })
  })

  it('uses the same default provider, mount, directory and node placement without a context menu', async () => {
    const params = fixture()
    const { result } = renderHook(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'project-a',
        currentMountId: 'mount-a',
        executionDirectory: '/repo/worktree',
        targetSpace: params.spacesRef.current[0],
      }),
    )
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
        placement: { targetSpaceRect: params.spacesRef.current[0].rect },
        agent: expect.objectContaining({ provider: 'codex', directoryMode: 'workspace' }),
      }),
    )
    expect(assignNodeToSpaceAndExpand).toHaveBeenCalledWith(
      expect.objectContaining({
        createdNodeId: 'new-agent',
        targetSpaceId: 'space-a',
      }),
    )
  })

  it('prevents concurrent menu and keyboard launches while mount resolution is pending', async () => {
    const params = fixture()
    params.contextMenu = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 }
    let resolveMount!: (
      value: Awaited<ReturnType<typeof resolveWorkspaceAgentLaunchBinding>>,
    ) => void
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveMount = resolve
        }),
    )
    const { result } = renderHook(() => useWorkspaceCanvasAgentLauncher(params))
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
    act(() => result.current.openAgentLauncherForProvider('claude-code'))
    await waitFor(() => expect(params.createNodeForSession).toHaveBeenCalledTimes(2))
    expect(launchWorkspaceAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'claude-code',
      }),
    )
    expect(params.setContextMenu).toHaveBeenCalledWith(null)
  })

  it('releases the launch guard after a failure so an explicit retry can run', async () => {
    const params = fixture()
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderHook(() => useWorkspaceCanvasAgentLauncher(params))
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(params.onShowMessage).toHaveBeenCalledWith(expect.stringContaining('Offline'), 'error')
    expect(launchWorkspaceAgentSession).not.toHaveBeenCalled()
    await act(() => result.current.launchAgentAtFlowPosition({ x: 400, y: 300 }))
    expect(launchWorkspaceAgentSession).toHaveBeenCalledTimes(1)
    expect(params.createNodeForSession).toHaveBeenCalledTimes(1)
  })
})
