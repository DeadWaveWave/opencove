import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'

describe('remote project agent launch', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockMounts(mounts: Array<{ mountId: string; rootPath: string }>) {
    const invoke = vi.fn().mockResolvedValue({ mounts })
    vi.stubGlobal('window', { opencoveApi: { controlSurface: { invoke } } })
    return invoke
  }

  const projectOptions = {
    workspaceId: 'project-remote',
    workspacePath: '/local/user-data/projects/project-remote',
    executionDirectory: '/local/user-data/projects/project-remote',
    currentMountId: null,
    targetSpace: null,
  }

  it.each([
    '/local/user-data/projects/project-remote',
    'C:\\Users\\test\\projects\\project-remote\\',
  ])('resolves the default mount for a placeholder on either host platform: %s', async path => {
    mockMounts([{ mountId: 'remote-mount', rootPath: '/remote/project' }])
    await expect(
      resolveWorkspaceAgentLaunchBinding({
        ...projectOptions,
        workspacePath: path,
        executionDirectory: path,
      }),
    ).resolves.toEqual({ mountId: 'remote-mount', executionDirectory: '/remote/project' })
  })

  it('preserves an explicitly selected mount over the project default', async () => {
    mockMounts([
      { mountId: 'default', rootPath: '/remote/default' },
      { mountId: 'selected', rootPath: '/remote/selected' },
    ])
    await expect(
      resolveWorkspaceAgentLaunchBinding({
        ...projectOptions,
        currentMountId: 'selected',
      }),
    ).resolves.toEqual({ mountId: 'selected', executionDirectory: '/remote/selected' })
  })

  it.each(['/external/worktree', '/remote/project/subdir'])(
    'preserves explicit execution directory %s',
    async directory => {
      mockMounts([{ mountId: 'remote-mount', rootPath: '/remote/project' }])
      await expect(
        resolveWorkspaceAgentLaunchBinding({
          ...projectOptions,
          executionDirectory: directory,
        }),
      ).resolves.toEqual({
        mountId: directory.startsWith('/remote/project') ? 'remote-mount' : null,
        executionDirectory: directory,
      })
    },
  )

  it('does not mistake an ordinary local project for an allocated placeholder', async () => {
    mockMounts([{ mountId: 'remote-mount', rootPath: '/remote/project' }])
    await expect(
      resolveWorkspaceAgentLaunchBinding({
        ...projectOptions,
        workspacePath: '/local/project',
        executionDirectory: '/local/project',
      }),
    ).resolves.toEqual({ mountId: null, executionDirectory: '/local/project' })
  })

  it('rejects a missing default mount instead of launching from a local placeholder', async () => {
    mockMounts([])
    await expect(resolveWorkspaceAgentLaunchBinding(projectOptions)).rejects.toThrow(
      'No default mount',
    )
  })

  it('propagates mount lookup failures even with the legacy ignore policy', async () => {
    mockMounts([]).mockRejectedValue(new Error('Worker unavailable'))
    await expect(resolveWorkspaceAgentLaunchBinding(projectOptions)).rejects.toThrow(
      'Worker unavailable',
    )
  })

  it('routes a project canvas launch to the remote mount instead of its local placeholder', async () => {
    const workspacePath = '/local/user-data/projects/project-remote'
    const invoke = vi.fn(async (request: { id: string }) => {
      if (request.id === 'mount.list') {
        return {
          mounts: [{ mountId: 'remote-mount', rootPath: '/remote/project' }],
        }
      }
      return {
        sessionId: 'remote-session',
        executionContext: {
          workingDirectory: '/remote/project',
          endpoint: { endpointId: 'remote-worker' },
          mountId: 'remote-mount',
        },
      }
    })
    const localLaunch = vi.fn(async () => ({ sessionId: 'local-session' }))
    vi.stubGlobal('window', {
      opencoveApi: { controlSurface: { invoke }, agent: { launch: localLaunch } },
    })

    const binding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: 'project-remote',
      workspacePath,
      executionDirectory: workspacePath,
      currentMountId: null,
      targetSpace: null,
      mountQueryFailurePolicy: 'throw',
    })
    const launched = await launchWorkspaceAgentSession({
      ...binding,
      workspacePath,
      provider: 'codex',
      prompt: '',
      mode: 'new',
      model: null,
      mergedEnv: {},
      agentSettings: { agentFullAccess: true, defaultTerminalProfileId: null },
      launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
    })

    expect(localLaunch).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: expect.objectContaining({
        mountId: 'remote-mount',
        cwdUri: 'file:///remote/project',
      }),
    })
    expect(launched.executionDirectory).toBe('/remote/project')
    expect(launched.workerBinding.endpointId).toBe('remote-worker')
  })
})
