import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSpaceMountLaunchContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/spaceMountLaunchContext'

describe('resolveSpaceMountLaunchContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('repairs stale space mount bindings and persists the updated space state', async () => {
    const onSpacesChange = vi.fn()
    const onRequestPersistFlush = vi.fn()
    const space = {
      id: 'space-1',
      name: 'Feature',
      directoryPath: '/repo/worktrees/feature-a',
      targetMountId: 'mount-stale',
      labelColor: null,
      nodeIds: [],
      rect: null,
    }

    vi.stubGlobal('window', {
      opencoveApi: {
        controlSurface: {
          invoke: vi.fn(async () => ({
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
                createdAt: '2026-05-10T00:00:00.000Z',
                updatedAt: '2026-05-10T00:00:00.000Z',
              },
            ],
          })),
        },
      },
    })

    const resolved = await resolveSpaceMountLaunchContext({
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      space,
      spaces: [space],
      onSpacesChange,
      onRequestPersistFlush,
    })

    expect(resolved.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe('/repo/worktrees/feature-a')
    expect(resolved.space).toMatchObject({
      targetMountId: 'mount-1',
      directoryPath: '/repo/worktrees/feature-a',
    })
    expect(onSpacesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'space-1',
        targetMountId: 'mount-1',
        directoryPath: '/repo/worktrees/feature-a',
      }),
    ])
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })
})
