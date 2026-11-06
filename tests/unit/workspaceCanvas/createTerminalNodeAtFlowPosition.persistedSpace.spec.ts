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

describe('createTerminalNodeAtFlowPosition persisted space launch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    const createNodeForSession = vi.fn(
      async () => ({ id: '00000000-0000-4000-8000-000000000001' }) as never,
    )
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
                    {
                      id: 'space-2',
                      name: 'Docs',
                      directoryPath: '/repo/docs',
                      targetMountId: 'mount-1',
                      labelColor: null,
                      nodeIds: ['existing-node'],
                      rect: { x: 1300, y: 0, width: 800, height: 600 },
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
        executionDirectory: '/repo/.opencove/worktrees/feature-a',
        expectedDirectory: '/repo/.opencove/worktrees/feature-a',
      }),
    )
    const nextSpaces = onSpacesChange.mock.calls[0]?.[0]
    expect(nextSpaces).toEqual([
      expect.objectContaining({
        id: 'space-1',
        name: 'Feature',
        directoryPath: '/repo/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['00000000-0000-4000-8000-000000000001'],
      }),
      expect.objectContaining({
        id: 'space-2',
        name: 'Docs',
        directoryPath: '/repo/docs',
        targetMountId: 'mount-1',
        nodeIds: ['existing-node'],
      }),
    ])
  })

  it('merges a persisted target space without replacing existing local spaces', async () => {
    const ptySpawn = vi.fn(async () => ({
      sessionId: 'session-worktree',
      profileId: null,
      runtimeKind: 'posix' as const,
    }))
    const createNodeForSession = vi.fn(
      async () => ({ id: '00000000-0000-4000-8000-000000000001' }) as never,
    )
    const onSpacesChange = vi.fn()
    const localSpace: WorkspaceSpaceState = {
      id: 'space-local',
      name: 'Scratch',
      directoryPath: '/repo/scratch',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['local-node'],
      rect: { x: 1400, y: 0, width: 800, height: 600 },
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
                      id: 'space-1',
                      name: 'Feature',
                      directoryPath: '/repo/.opencove/worktrees/feature-a',
                      targetMountId: 'mount-1',
                      labelColor: null,
                      nodeIds: [],
                      rect: { x: 0, y: 0, width: 1200, height: 800 },
                    },
                    {
                      id: 'space-2',
                      name: 'Docs',
                      directoryPath: '/repo/docs',
                      targetMountId: null,
                      labelColor: null,
                      nodeIds: ['existing-node'],
                      rect: { x: 2300, y: 0, width: 800, height: 600 },
                    },
                  ],
                },
              ],
            },
            recovery: null,
          })),
        },
      },
    })

    await createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: 'workspace-1',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '/repo',
      spacesRef: { current: [localSpace] },
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
    const nextSpaces = onSpacesChange.mock.calls[0]?.[0]
    expect(nextSpaces).toEqual([
      expect.objectContaining({
        id: 'space-local',
        name: 'Scratch',
        directoryPath: '/repo/scratch',
        nodeIds: ['local-node'],
      }),
      expect.objectContaining({
        id: 'space-1',
        name: 'Feature',
        directoryPath: '/repo/.opencove/worktrees/feature-a',
        targetMountId: 'mount-1',
        nodeIds: ['00000000-0000-4000-8000-000000000001'],
      }),
      expect.objectContaining({
        id: 'space-2',
        name: 'Docs',
        directoryPath: '/repo/docs',
        nodeIds: ['existing-node'],
      }),
    ])
  })
})
