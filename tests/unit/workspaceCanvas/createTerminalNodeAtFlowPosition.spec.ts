import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'

describe('createTerminalNodeAtFlowPosition', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to the persisted active workspace when local workspace state is not hydrated yet', async () => {
    const ptySpawn = vi.fn(async () => ({
      sessionId: 'session-1',
      profileId: null,
      runtimeKind: 'posix' as const,
    }))
    const createNodeForSession = vi.fn(async () => ({ id: 'node-1' }) as never)

    vi.stubGlobal('window', {
      opencoveApi: {
        pty: {
          spawn: ptySpawn,
        },
        persistence: {
          readAppState: vi.fn(async () => ({
            state: {
              activeWorkspaceId: 'workspace-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  path: '/workspace/root',
                  activeSpaceId: 'space-1',
                  spaces: [
                    {
                      id: 'space-1',
                      name: 'Main',
                      directoryPath: '/workspace/root/space',
                      targetMountId: null,
                      labelColor: null,
                      nodeIds: [],
                      rect: { x: 0, y: 0, width: 1200, height: 800 },
                    },
                  ],
                },
              ],
            },
            recovery: null,
          })),
        },
        controlSurface: {
          invoke: vi.fn(),
        },
      },
    })

    const result = await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '',
      spacesRef: { current: [] },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange: vi.fn(),
      createNodeForSession,
    })

    expect(ptySpawn).toHaveBeenCalledWith({
      cwd: '/workspace/root/space',
      cols: 80,
      rows: 24,
      profileId: undefined,
    })
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        executionDirectory: '/workspace/root/space',
        expectedDirectory: '/workspace/root/space',
      }),
    )
    expect(result).toEqual({
      sessionId: 'session-1',
      nodeId: 'node-1',
    })
  })

  it('does not guess mount ownership from the workspace id when only a local workspace path is known', async () => {
    const ptySpawn = vi.fn(async () => ({
      sessionId: 'session-2',
      profileId: null,
      runtimeKind: 'posix' as const,
    }))
    const controlSurfaceInvoke = vi.fn()
    const createNodeForSession = vi.fn(async () => ({ id: 'node-2' }) as never)

    vi.stubGlobal('window', {
      opencoveApi: {
        pty: {
          spawn: ptySpawn,
        },
        persistence: {
          readAppState: vi.fn(async () => ({
            state: {
              activeWorkspaceId: 'workspace-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  path: '/workspace/root',
                  activeSpaceId: null,
                  spaces: [],
                },
              ],
            },
            recovery: null,
          })),
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
      },
    })

    await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '',
      spacesRef: { current: [] },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange: vi.fn(),
      createNodeForSession,
    })

    expect(controlSurfaceInvoke).not.toHaveBeenCalled()
    expect(ptySpawn).toHaveBeenCalledWith({
      cwd: '/workspace/root',
      cols: 80,
      rows: 24,
      profileId: undefined,
    })
  })

  it('uses the default mount instead of the placeholder project path for remote-only projects', async () => {
    const ptySpawn = vi.fn()
    const controlSurfaceInvoke = vi
      .fn()
      .mockResolvedValueOnce({
        mounts: [
          {
            mountId: 'mount-remote',
            endpointId: 'endpoint-1',
            rootPath: '/remote/root',
          },
        ],
      })
      .mockResolvedValueOnce({
        sessionId: 'session-remote',
        profileId: null,
        runtimeKind: 'posix' as const,
      })
    const createNodeForSession = vi.fn(async () => ({ id: 'node-remote' }) as never)

    vi.stubGlobal('window', {
      opencoveApi: {
        pty: {
          spawn: ptySpawn,
        },
        persistence: {
          readAppState: vi.fn(async () => ({
            state: {
              activeWorkspaceId: 'workspace-remote',
              workspaces: [
                {
                  id: 'workspace-remote',
                  path: '/tmp/opencove/projects/workspace-remote',
                  activeSpaceId: null,
                  spaces: [],
                },
              ],
            },
            recovery: null,
          })),
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
      },
    })

    const result = await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-remote',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '',
      spacesRef: { current: [] },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange: vi.fn(),
      createNodeForSession,
    })

    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(1, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: 'workspace-remote' },
    })
    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(2, {
      kind: 'command',
      id: 'pty.spawnInMount',
      payload: {
        mountId: 'mount-remote',
        cwdUri: null,
        profileId: null,
        cols: 80,
        rows: 24,
      },
    })
    expect(ptySpawn).not.toHaveBeenCalled()
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-remote',
        executionDirectory: '/remote/root',
        expectedDirectory: '/remote/root',
      }),
    )
    expect(result).toEqual({
      sessionId: 'session-remote',
      nodeId: 'node-remote',
    })
  })
})
