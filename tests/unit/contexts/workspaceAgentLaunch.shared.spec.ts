import type { MutableRefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'

function createSpacesRef(spaces: WorkspaceSpaceState[]): MutableRefObject<WorkspaceSpaceState[]> {
  return { current: spaces }
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

    const spacesRef = createSpacesRef([
      {
        id: 'space-1',
        name: 'API',
        directoryPath: '/project/apps/api',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['role-node-1'],
        rect: null,
      },
    ])
    const onSpacesChange = vi.fn()

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/project/apps/api',
      targetSpace: spacesRef.current[0],
      spacesRef,
      onSpacesChange,
    })

    expect(binding).toEqual({
      mountId: 'mount-api',
      executionDirectory: '/project/apps/api',
    })
    expect(onSpacesChange).toHaveBeenCalledTimes(1)
    expect(spacesRef.current[0]?.targetMountId).toBe('mount-api')
  })

  it('does not bind an external worktree directory to the first project mount', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke.mockResolvedValueOnce({
      mounts: [{ mountId: 'mount-root', rootPath: '/project' }],
    })

    const spacesRef = createSpacesRef([
      {
        id: 'space-1',
        name: 'External',
        directoryPath: '/external/worktrees/feature-a',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: null,
      },
    ])
    const onSpacesChange = vi.fn()

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'workspace-1',
      workspacePath: '/project',
      currentMountId: null,
      executionDirectory: '/external/worktrees/feature-a',
      targetSpace: spacesRef.current[0],
      spacesRef,
      onSpacesChange,
    })

    expect(binding).toEqual({
      mountId: null,
      executionDirectory: '/external/worktrees/feature-a',
    })
    expect(onSpacesChange).not.toHaveBeenCalled()
    expect(spacesRef.current[0]?.targetMountId).toBeNull()
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
        defaultTerminalProfileId: null,
      },
      launchGeometry: {
        terminalGeometry: { cols: 120, rows: 40 },
      },
    })

    expect(launched.executionDirectory).toBe('/external/worktrees/feature-a')
    expect(window.opencoveApi.agent.launch).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'session.launchAgent',
      payload: expect.objectContaining({
        cwd: '/external/worktrees/feature-a',
      }),
    })
  })

  it('retries mount launches after refreshing the mount binding', async () => {
    const invoke = vi.mocked(window.opencoveApi.controlSurface.invoke)
    invoke.mockRejectedValueOnce(new Error('stale mount')).mockResolvedValueOnce({
      sessionId: 'session-2',
      profileId: 'profile-1',
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      executionContext: {
        workingDirectory: '/remote/project',
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
      profileId: 'profile-1',
      runtimeKind: 'posix',
      effectiveModel: 'gpt-5.2-codex',
      executionDirectory: '/remote/project',
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        mountId: 'mount-fresh',
      },
    })
  })
})
