import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '../../../src/contexts/workspace/domain/terminalPtyGeometry'
import { resolveDefaultTerminalWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function regularTerminalLaunchGeometry() {
  return resolveTerminalPtyGeometryForNodeFrame({
    ...resolveDefaultTerminalWindowSize('regular'),
    terminalFontSize: DEFAULT_AGENT_SETTINGS.terminalFontSize,
  })
}

describe('createTerminalNodeAtFlowPosition space worktree launch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
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
    const createNodeForSession = vi.fn(
      async () => ({ id: '00000000-0000-4000-8000-000000000001' }) as never,
    )
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
        canvasNodeId: '00000000-0000-4000-8000-000000000001',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
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
        nodeId: '00000000-0000-4000-8000-000000000001',
        sessionId: 'session-worktree',
        terminalGeometry: expectedGeometry,
        executionDirectory: '/repo/.opencove/worktrees/feature-a',
        expectedDirectory: '/repo/.opencove/worktrees/feature-a',
      }),
    )
    expect(result).toEqual({
      sessionId: 'session-worktree',
      nodeId: '00000000-0000-4000-8000-000000000001',
    })
    expect(onSpacesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'space-1',
        name: 'Feature',
        directoryPath: '/repo/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    ])
  })

  it('does not overwrite local space metadata changed while a terminal launch is in flight', async () => {
    const ptySpawn = vi.fn(async () => ({
      sessionId: 'session-worktree',
      profileId: null,
      runtimeKind: 'posix' as const,
    }))
    const controlSurfaceInvoke = vi.fn(async () => ({
      projectId: 'workspace-1',
      mounts: [],
    }))
    const onSpacesChange = vi.fn()
    const originalSpace: WorkspaceSpaceState = {
      id: 'space-1',
      name: 'Feature',
      directoryPath: '/repo',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: { x: 0, y: 0, width: 1200, height: 800 },
    }
    const changedBoundary = {
      allowedMountIds: ['mount-local'],
      scopesByMountId: {},
      allowedPluginIds: null,
      capabilities: null,
      trustLevel: null,
    }
    const spacesRef: { current: WorkspaceSpaceState[] } = {
      current: [originalSpace],
    }
    const createNodeForSession = vi.fn(async () => {
      spacesRef.current = [
        {
          ...originalSpace,
          name: 'Renamed Locally',
          directoryPath: '/repo/manual-change',
          targetMountId: 'mount-local',
          parentSpaceId: 'parent-local',
          boundary: changedBoundary,
          sortOrder: 42,
        },
      ]
      return { id: '00000000-0000-4000-8000-000000000001' } as never
    })

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
                      ...originalSpace,
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

    await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '/repo',
      spacesRef,
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange,
      createNodeForSession,
    })

    expect(ptySpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/.opencove/worktrees/feature-a',
      }),
    )
    expect(onSpacesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'space-1',
        name: 'Renamed Locally',
        directoryPath: '/repo/manual-change',
        targetMountId: 'mount-local',
        parentSpaceId: 'parent-local',
        boundary: changedBoundary,
        sortOrder: 42,
        nodeIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    ])
  })
})
