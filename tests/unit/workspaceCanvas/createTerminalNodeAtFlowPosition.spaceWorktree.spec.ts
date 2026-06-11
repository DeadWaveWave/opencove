import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '../../../src/contexts/workspace/domain/terminalPtyGeometry'
import { resolveDefaultTerminalWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'

function regularTerminalLaunchGeometry() {
  return resolveTerminalPtyGeometryForNodeFrame({
    ...resolveDefaultTerminalWindowSize('regular'),
    terminalFontSize: DEFAULT_AGENT_SETTINGS.terminalFontSize,
  })
}

describe('createTerminalNodeAtFlowPosition space worktree launch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes a matched space from persisted state before launching a terminal', async () => {
    const ptySpawn = vi.fn()
    const controlSurfaceInvoke = vi.fn(async (request: { id: string }) => {
      if (request.id === 'mount.list') {
        return {
          projectId: 'workspace-1',
          mounts: [
            {
              mountId: 'mount-1',
              projectId: 'workspace-1',
              name: 'Primary',
              sortOrder: 0,
              endpointId: 'local',
              targetId: 'target-1',
              rootPath: '/repo',
              rootUri: 'file:///repo',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        }
      }

      return {
        sessionId: 'session-worktree',
        profileId: null,
        runtimeKind: 'posix' as const,
      }
    })
    const createNodeForSession = vi.fn(async () => ({ id: 'node-worktree' }) as never)
    const onSpacesChange = vi.fn()
    const staleSpace = {
      id: 'space-1',
      name: 'Feature',
      directoryPath: '/repo',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: { x: 0, y: 0, width: 1200, height: 800 },
    }

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
                  path: '/repo',
                  activeSpaceId: 'space-1',
                  spaces: [
                    {
                      ...staleSpace,
                      directoryPath: '/repo/.opencove/worktrees/feature-a',
                      targetMountId: 'mount-1',
                    },
                  ],
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
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '/repo',
      spacesRef: { current: [staleSpace] },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange,
      createNodeForSession,
    })
    const expectedGeometry = regularTerminalLaunchGeometry()

    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(1, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: 'workspace-1' },
    })
    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(2, {
      kind: 'command',
      id: 'pty.spawnInMount',
      payload: {
        mountId: 'mount-1',
        cwdUri: 'file:///repo/.opencove/worktrees/feature-a',
        profileId: null,
        cols: expectedGeometry.cols,
        rows: expectedGeometry.rows,
      },
    })
    expect(ptySpawn).not.toHaveBeenCalled()
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-worktree',
        terminalGeometry: expectedGeometry,
        executionDirectory: '/repo/.opencove/worktrees/feature-a',
        expectedDirectory: '/repo/.opencove/worktrees/feature-a',
      }),
    )
    expect(result).toEqual({
      sessionId: 'session-worktree',
      nodeId: 'node-worktree',
    })
    expect(onSpacesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'space-1',
        name: 'Feature',
        directoryPath: '/repo/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['node-worktree'],
      }),
    ])
  })

  it('uses a persisted containing space when local spaces are not hydrated yet', async () => {
    const ptySpawn = vi.fn()
    const controlSurfaceInvoke = vi.fn(async (request: { id: string }) => {
      if (request.id === 'mount.list') {
        return {
          projectId: 'workspace-1',
          mounts: [
            {
              mountId: 'mount-1',
              projectId: 'workspace-1',
              name: 'Primary',
              sortOrder: 0,
              endpointId: 'local',
              targetId: 'target-1',
              rootPath: '/repo',
              rootUri: 'file:///repo',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        }
      }

      return {
        sessionId: 'session-worktree',
        profileId: null,
        runtimeKind: 'posix' as const,
      }
    })
    const createNodeForSession = vi.fn(async () => ({ id: 'node-worktree' }) as never)
    const onSpacesChange = vi.fn()

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
                  path: '/repo',
                  activeSpaceId: 'space-1',
                  spaces: [
                    {
                      id: 'space-1',
                      name: 'Feature',
                      directoryPath: '/repo/.opencove/worktrees/feature-a',
                      targetMountId: 'mount-1',
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
          invoke: controlSurfaceInvoke,
        },
      },
    })

    await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '/repo',
      spacesRef: { current: [] },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange,
      createNodeForSession,
    })
    const expectedGeometry = regularTerminalLaunchGeometry()

    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(1, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: 'workspace-1' },
    })
    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(2, {
      kind: 'command',
      id: 'pty.spawnInMount',
      payload: {
        mountId: 'mount-1',
        cwdUri: 'file:///repo/.opencove/worktrees/feature-a',
        profileId: null,
        cols: expectedGeometry.cols,
        rows: expectedGeometry.rows,
      },
    })
    expect(ptySpawn).not.toHaveBeenCalled()
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        executionDirectory: '/repo/.opencove/worktrees/feature-a',
        expectedDirectory: '/repo/.opencove/worktrees/feature-a',
      }),
    )
    expect(onSpacesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'space-1',
        name: 'Feature',
        directoryPath: '/repo/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['node-worktree'],
      }),
    ])
  })
})
