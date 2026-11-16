import { reviveRendererAppError } from '@shared/errors/rendererAppError'
import { createAppError } from '@shared/errors/appError'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasDocumentCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { replaceWorkspaceSpaces } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasDocumentCommands,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'

function apiSpace(overrides: Partial<WorkspaceSpaceState> = {}): WorkspaceSpaceState {
  return {
    id: 'space-1',
    name: 'API',
    directoryPath: '/project/apps/api',
    targetMountId: null,
    labelColor: null,
    nodeIds: ['role-node-1'],
    rect: null,
    ...overrides,
  }
}

function renderUpdateSpaces(workspaceId: string) {
  return renderCanvasDocumentCommands(workspaceId).updateSpaces
}

describe('workspaceAgentLaunch.shared', () => {
  beforeEach(() => {
    window.opencoveApi = {
      controlSurface: {
        invoke: vi.fn(),
      },
      agent: {
        launch: vi.fn(),
      },
    } as typeof window.opencoveApi
  })

  it('repairs missing Space mount bindings using the best matching mount', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke.mockResolvedValueOnce({
      mounts: [
        { mountId: 'mount-root', rootPath: '/project' },
        { mountId: 'mount-api', rootPath: '/project/apps/api' },
      ],
    })

    const harness = createCanvasDocumentHarness({ spaces: [apiSpace()] })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace(),
      updateSpaces,
    })

    expect(binding).toEqual({
      mountId: 'mount-api',
      executionDirectory: '/project/apps/api',
    })
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces).toEqual([
      expect.objectContaining({ id: 'space-1', targetMountId: 'mount-api' }),
    ])
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('does not bind an external worktree directory to the first project mount', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke.mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-root', rootPath: '/project' }],
    })

    const external = apiSpace({ name: 'External', directoryPath: '/external/worktrees/feature-a' })
    const harness = createCanvasDocumentHarness({ spaces: [external] })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/external/worktrees/feature-a',
      targetSpace: external,
      updateSpaces,
    })

    expect(binding).toEqual({
      mountId: null,
      executionDirectory: '/external/worktrees/feature-a',
    })
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces[0]?.targetMountId).toBeNull()
  })

  // The binding writes at the moment the mount query answers, so a Space that was added to the
  // store during the await is part of what it writes onto (#702).
  it('keeps a Space added to the store while mount.list was pending and writes once', async () => {
    const harness = createCanvasDocumentHarness({ spaces: [apiSpace()] })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    let resolveMounts!: (value: unknown) => void
    invoke.mockReturnValueOnce(new Promise(resolve => (resolveMounts = resolve)) as never)

    const binding = resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace(),
      updateSpaces,
    })
    act(() => {
      replaceWorkspaceSpaces('workspace-1', [
        ...harness.readStoreDocument().spaces,
        apiSpace({ id: 'space-late', name: 'Late' }),
      ])
    })
    harness.notifications.mockClear()
    resolveMounts({ mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }] })
    await binding

    expect(harness.readStoreDocument().spaces.map(item => [item.id, item.targetMountId])).toEqual([
      ['space-1', 'mount-api'],
      ['space-late', null],
    ])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes and flushes nothing when the Space already has the resolved mount', async () => {
    const harness = createCanvasDocumentHarness({
      spaces: [apiSpace({ targetMountId: 'mount-api' })],
    })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)
    vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }],
    })

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: 'mount-api',
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace({ targetMountId: 'mount-api' }),
      updateSpaces,
    })
    expect(binding.mountId).toBe('mount-api')

    // A target whose mount is already the resolved one, with a caller that holds an older
    // current mount, is the other no-write path.
    vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }],
    })
    await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace({ targetMountId: 'mount-api' }),
      updateSpaces,
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('writes and flushes nothing without a writer, as the owned task run passes none', async () => {
    const harness = createCanvasDocumentHarness({ spaces: [apiSpace()] })
    vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }],
    })

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace(),
    })

    expect(binding.mountId).toBe('mount-api')
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces[0]?.targetMountId).toBeNull()
  })

  it('writes nothing when the target Space is no longer in the store', async () => {
    const harness = createCanvasDocumentHarness({
      spaces: [apiSpace({ id: 'space-other', name: 'Other' })],
    })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)
    vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }],
    })

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: apiSpace(),
      updateSpaces,
    })

    expect(binding.mountId).toBe('mount-api')
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces.map(item => item.targetMountId)).toEqual([null])
  })

  it('writes nothing when there is no target Space', async () => {
    const harness = createCanvasDocumentHarness({ spaces: [apiSpace()] })
    const updateSpaces = renderUpdateSpaces(harness.workspaceId)
    vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }],
    })

    await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: null,
      updateSpaces,
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('launches external worktree agents through the control surface plain runtime', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke.mockResolvedValueOnce({
      sessionId: 'session-external',
      profileId: 'profile-1',
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      executionContext: {
        workingDirectory: '/external/worktrees/feature-a',
        endpoint: { endpointId: 'local' },
        mountId: null,
      },
    })

    const launched = await launchWorkspaceAgentSession({
      mountId: null,
      workspacePath: '/project',
      executionDirectory: '/external/worktrees/feature-a',
      prompt: '',
      provider: 'codex',
      mode: 'new',
      model: 'gpt-5.2-codex',
      executablePathOverride: null,
      mergedEnv: {},
      agentSettings: {
        agentFullAccess: true,
        codexReuseRunningAppServer: true,
        defaultTerminalProfileId: null,
      },
      launchGeometry: {
        terminalGeometry: { cols: 120, rows: 40 },
      },
    })

    expect(launched.executionDirectory).toBe('/external/worktrees/feature-a')
    expect(launched.workerBinding).toEqual({ endpointId: 'local', mountId: null })
    expect(window.opencoveApi.agent.launch).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'session.launchAgent',
      clientFeatures: { managedClaudeResumeBindingV1: true },
      payload: expect.objectContaining({
        cwd: '/external/worktrees/feature-a',
        codexReuseRunningAppServer: true,
      }),
    })
  })

  it('retries mount launches after refreshing the mount binding', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke
      .mockRejectedValueOnce(
        createAppError('agent.launch_failed', {
          details: { managedClaudeLaunch: true, phase: 'beforeSpawn', reason: 'mountUnavailable' },
        }),
      )
      .mockResolvedValueOnce({
        sessionId: 'session-2',
        profileId: 'profile-1',
        runtimeKind: 'posix',
        effectiveModel: 'gpt-5.2-codex',
        executionContext: {
          workingDirectory: '/remote/project',
          endpoint: { endpointId: 'endpoint-remote' },
          mountId: 'mount-fresh',
          codexReuseRunningAppServer: true,
        },
      })

    const launched = await launchWorkspaceAgentSession({
      mountId: 'mount-stale',
      workspacePath: '/project',
      executionDirectory: '/project',
      prompt: 'Implement the feature.',
      provider: 'codex',
      mode: 'new',
      model: 'gpt-5.2-codex',
      executablePathOverride: null,
      mergedEnv: {},
      agentSettings: {
        agentFullAccess: true,
        codexReuseRunningAppServer: true,
        defaultTerminalProfileId: null,
      },
      launchGeometry: {
        terminalGeometry: { cols: 120, rows: 40 },
      },
      retryResolveMountBinding: async failedMountId => {
        expect(failedMountId).toBe('mount-stale')
        return {
          mountId: 'mount-fresh',
          executionDirectory: '/project',
        }
      },
    })

    expect(launched).toEqual({
      sessionId: 'session-2',
      resumeSessionId: null,
      profileId: 'profile-1',
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      executionDirectory: '/remote/project',
      workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-fresh' },
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({
      kind: 'command',
      id: 'session.launchAgentInMount',
      clientFeatures: { managedClaudeResumeBindingV1: true },
      payload: {
        mountId: 'mount-fresh',
        codexReuseRunningAppServer: true,
      },
    })
  })

  it.each(['mount', 'retry', 'plain', 'legacy'] as const)(
    'passes Codex reuse settings through the %s renderer resume route',
    async route => {
      const response = {
        sessionId: 'runtime-codex',
        resumeSessionId: 'codex-a',
        profileId: null,
        effectiveModel: null,
        executionContext: {
          workingDirectory: '/repo',
          endpoint: { endpointId: 'local' },
          mountId: null,
        },
      }
      const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
      if (route === 'retry') {
        invoke.mockRejectedValueOnce(
          createAppError('agent.launch_failed', {
            details: {
              managedClaudeLaunch: true,
              phase: 'beforeSpawn',
              reason: 'mountUnavailable',
            },
          }),
        )
      }
      invoke.mockResolvedValue(response)
      const launch = vi.mocked(window.opencoveApi.agent.launch)
      launch.mockResolvedValue(response as never)
      await launchWorkspaceAgentSession({
        mountId: route === 'mount' || route === 'retry' ? 'mount-old' : null,
        workspacePath: route === 'plain' ? '/elsewhere' : '/repo',
        executionDirectory: '/repo',
        provider: 'codex',
        mode: 'resume',
        resumeSessionId: 'codex-a',
        prompt: '',
        model: null,
        mergedEnv: {},
        agentSettings: {
          agentFullAccess: false,
          codexReuseRunningAppServer: true,
          defaultTerminalProfileId: null,
        },
        launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
        retryResolveMountBinding: async () => ({ mountId: 'mount-a', executionDirectory: '/repo' }),
      })
      const expected = {
        codexReuseRunningAppServer: true,
        mode: 'resume',
        resumeSessionId: 'codex-a',
      }
      if (route === 'legacy') {
        expect(launch).toHaveBeenCalledWith(expect.objectContaining(expected))
      } else {
        for (const [request] of invoke.mock.calls) {
          expect(request).toMatchObject({ payload: expected })
        }
      }
    },
  )

  it.each(['mount', 'retry', 'plain', 'legacy'] as const)(
    'returns the assigned Claude session ID from the %s launch route',
    async route => {
      const response = {
        sessionId: 'runtime-a',
        resumeSessionId: 'claude-a',
        profileId: null,
        effectiveModel: null,
        executionContext: {
          workingDirectory: '/repo',
          endpoint: { endpointId: 'local' },
          mountId: route === 'mount' || route === 'retry' ? 'mount-a' : null,
        },
      }
      const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
      if (route === 'retry') {
        invoke.mockRejectedValueOnce(
          createAppError('agent.launch_failed', {
            details: {
              managedClaudeLaunch: true,
              phase: 'beforeSpawn',
              reason: 'mountUnavailable',
            },
          }),
        )
      }
      invoke.mockResolvedValue(response)
      vi.mocked(window.opencoveApi.agent.launch).mockResolvedValue(response as never)
      const launched = await launchWorkspaceAgentSession({
        mountId: route === 'mount' || route === 'retry' ? 'mount-old' : null,
        workspacePath: route === 'plain' ? '/elsewhere' : '/repo',
        executionDirectory: '/repo',
        provider: 'claude-code',
        mode: 'new',
        prompt: '',
        model: null,
        mergedEnv: {},
        agentSettings: {
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: null,
        },
        launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
        retryResolveMountBinding: async () => ({ mountId: 'mount-a', executionDirectory: '/repo' }),
      })
      expect(launched.resumeSessionId).toBe('claude-a')
    },
  )

  // The first defect of #703: after a switch, the binding wrote the Spaces of the workspace that
  // was shown by then into the workspace it started in.
  it('writes the Spaces of the workspace it started in after a switch during the mount query', async () => {
    const spaceOf = (id: string, targetMountId: string | null): WorkspaceSpaceState => ({
      id,
      name: id,
      directoryPath: '/project/apps/api',
      targetMountId,
      labelColor: null,
      nodeIds: [],
      rect: null,
    })
    const harness = createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      spaces: [spaceOf('space-a', null)],
    })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        { ...state.workspaces[0], id: 'workspace-b', spaces: [spaceOf('space-b', null)] },
      ],
    }))
    let shown = 'workspace-a'
    const view = renderInCanvasDocument(() => useCanvasDocumentCommands(), {
      workspaceId: () => shown,
    })
    const updateSpacesOfA = view.result.current.updateSpaces
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    let resolveMounts!: (value: unknown) => void
    invoke.mockReturnValueOnce(new Promise(resolve => (resolveMounts = resolve)) as never)

    const binding = resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-a',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: spaceOf('space-a', null),
      updateSpaces: updateSpacesOfA,
    })
    // During the await another writer adds a Space to A, and the user switches to B.
    act(() => {
      replaceWorkspaceSpaces('workspace-a', [
        ...harness.readStoreDocument().spaces,
        spaceOf('space-late', null),
      ])
      shown = 'workspace-b'
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
      view.rerender()
    })
    const workspaceBBefore = useAppStore.getState().workspaces[1]

    resolveMounts({ mounts: [{ mountId: 'mount-api', rootPath: '/project/apps/api' }] })
    await binding

    const [workspaceA, workspaceB] = useAppStore.getState().workspaces
    expect(workspaceA.spaces.map(item => [item.id, item.targetMountId])).toEqual([
      ['space-a', 'mount-api'],
      ['space-late', null],
    ])
    expect(workspaceB).toBe(workspaceBBefore)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})

it.each(['unknown', 'superseded', 'nodeGone', 'conflict', 'afterSpawn', 'corrupted'])(
  'never retries a managed %s outcome on another mount',
  async reason => {
    const error = reviveRendererAppError(
      reason === 'corrupted'
        ? null
        : reason === 'unknown'
          ? { code: 'agent.managed_launch_commit_failed', details: { outcome: 'unknown' } }
          : reason === 'afterSpawn'
            ? {
                code: 'agent.launch_failed',
                details: { managedClaudeLaunch: true, phase: 'afterSpawn' },
              }
            : { code: 'agent.managed_launch_rejected', details: { reason } },
    )
    const invoke = vi.fn().mockImplementation(async request => {
      if (request.id === 'system.capabilities') {
        return { features: { managedClaudeResumeBindingDeliveryV1: true } }
      }
      throw error
    })
    window.opencoveApi = { controlSurface: { invoke } } as unknown as typeof window.opencoveApi
    const retry = vi.fn()
    await expect(
      launchWorkspaceAgentSession({
        canvasNodeId: 'agent',
        workspaceId: 'workspace',
        mountId: 'old',
        workspacePath: '/repo',
        executionDirectory: '/repo',
        provider: 'claude-code',
        mode: 'new',
        prompt: '',
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
    ).rejects.toBe(error)
    expect(invoke.mock.calls.map(([request]) => request.id)).toEqual([
      'system.capabilities',
      'session.launchAgentInMount',
    ])
    expect(retry).not.toHaveBeenCalled()
  },
)
