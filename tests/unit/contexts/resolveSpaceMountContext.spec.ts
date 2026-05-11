import { describe, expect, it } from 'vitest'
import { resolveSpaceMountContext } from '../../../src/contexts/space/application/resolveSpaceMountContext'
import type { MountDto } from '../../../src/shared/contracts/dto'

function createMount(overrides: Partial<MountDto>): MountDto {
  return {
    mountId: 'mount-1',
    projectId: 'project-1',
    name: 'Primary',
    sortOrder: 0,
    endpointId: 'local',
    targetId: 'target-1',
    rootPath: '/repo',
    rootUri: 'file:///repo',
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveSpaceMountContext', () => {
  it('keeps a nested working directory when the selected mount is valid', () => {
    const resolved = resolveSpaceMountContext({
      space: {
        directoryPath: '/repo/worktrees/feature-a',
        targetMountId: 'mount-1',
      },
      workspacePath: '/repo',
      mounts: [createMount({})],
    })

    expect(resolved.mount?.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe('/repo/worktrees/feature-a')
    expect(resolved.repair).toBeNull()
  })

  it('repairs stale target mounts by inferring the mount from directoryPath', () => {
    const resolved = resolveSpaceMountContext({
      space: {
        directoryPath: '/repo/worktrees/feature-a',
        targetMountId: 'mount-stale',
      },
      workspacePath: '/repo',
      mounts: [createMount({})],
    })

    expect(resolved.mount?.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe('/repo/worktrees/feature-a')
    expect(resolved.repair).toEqual({
      targetMountId: 'mount-1',
      directoryPath: '/repo/worktrees/feature-a',
    })
  })

  it('falls back to the mount root when directoryPath escapes the selected mount', () => {
    const resolved = resolveSpaceMountContext({
      space: {
        directoryPath: '/tmp/elsewhere',
        targetMountId: 'mount-1',
      },
      workspacePath: '/repo',
      mounts: [createMount({})],
    })

    expect(resolved.mount?.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe('/repo')
    expect(resolved.repair).toEqual({
      targetMountId: 'mount-1',
      directoryPath: '/repo',
    })
  })

  it('uses child boundary scope as the working directory and repairs projection drift', () => {
    const resolved = resolveSpaceMountContext({
      space: {
        directoryPath: '/repo',
        targetMountId: 'mount-1',
        boundary: {
          allowedMountIds: ['mount-1'],
          scopesByMountId: {
            'mount-1': {
              rootPath: '/repo/packages/app',
              rootUri: 'file:///repo/packages/app',
            },
          },
          allowedPluginIds: null,
          capabilities: null,
          trustLevel: null,
        },
      },
      workspacePath: '/repo',
      mounts: [createMount({})],
    })

    expect(resolved.mount?.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe('/repo/packages/app')
    expect(resolved.scope).toEqual({
      rootPath: '/repo/packages/app',
      rootUri: 'file:///repo/packages/app',
    })
    expect(resolved.repair).toEqual({
      targetMountId: 'mount-1',
      directoryPath: '/repo/packages/app',
    })
  })
})
