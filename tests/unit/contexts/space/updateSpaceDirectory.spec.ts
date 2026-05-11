import { describe, expect, it } from 'vitest'
import { computeSpaceDirectoryUpdate } from '../../../../src/contexts/space/application/updateSpaceDirectory'

describe('computeSpaceDirectoryUpdate', () => {
  it('updates directory and name while preserving other fields', () => {
    const spaces = [
      {
        id: 'space-1',
        name: 'Inbox',
        directoryPath: '',
        nodeIds: ['n1'],
        rect: { x: 1, y: 2, width: 3, height: 4 },
      },
    ]

    const result = computeSpaceDirectoryUpdate({
      workspacePath: '/repo',
      spaces,
      spaceId: 'space-1',
      directoryPath: '/repo/.opencove/worktrees/feat-inbox',
      options: { renameSpaceTo: 'feat/inbox' },
    })

    expect(result?.nextSpaces).toEqual([
      {
        ...spaces[0],
        name: 'feat/inbox',
        directoryPath: '/repo/.opencove/worktrees/feat-inbox',
        boundary: {
          allowedMountIds: [],
          scopesByMountId: {},
          allowedPluginIds: null,
          capabilities: null,
          trustLevel: null,
        },
      },
    ])
    expect(result?.previousEffectiveDirectory).toBe('/repo')
    expect(result?.targetNodeIds.has('n1')).toBe(true)
  })

  it('archives the target space', () => {
    const spaces = [
      { id: 'space-1', name: 'A', directoryPath: '/repo', nodeIds: [] },
      { id: 'space-2', name: 'B', directoryPath: '/repo/b', nodeIds: [] },
    ]

    const result = computeSpaceDirectoryUpdate({
      workspacePath: '/repo',
      spaces,
      spaceId: 'space-1',
      directoryPath: '/repo',
      options: { archiveSpace: true },
    })

    expect(result?.nextSpaces).toEqual([spaces[1]])
    expect(result?.archiveSpace).toBe(true)
  })

  it('archives descendant child spaces with the parent', () => {
    const spaces = [
      { id: 'parent', name: 'Parent', directoryPath: '/repo', nodeIds: ['node-a'] },
      {
        id: 'child',
        name: 'Child',
        directoryPath: '/repo/packages/app',
        parentSpaceId: 'parent',
        nodeIds: ['node-b'],
      },
      { id: 'sibling', name: 'Sibling', directoryPath: '/repo/other', nodeIds: ['node-c'] },
    ]

    const result = computeSpaceDirectoryUpdate({
      workspacePath: '/repo',
      spaces,
      spaceId: 'parent',
      directoryPath: '/repo',
      options: { archiveSpace: true },
    })

    expect(result?.nextSpaces).toEqual([spaces[2]])
    expect([...Array.from(result?.targetNodeIds ?? [])].sort()).toEqual(['node-a', 'node-b'])
  })

  it('cascades directory projection to child spaces that inherited the parent scope', () => {
    const spaces = [
      {
        id: 'parent',
        name: 'Parent',
        directoryPath: '/repo',
        targetMountId: 'mount-1',
        nodeIds: [],
      },
      {
        id: 'child-inherited',
        name: 'Child',
        directoryPath: '/repo',
        targetMountId: 'mount-1',
        parentSpaceId: 'parent',
        boundary: {
          allowedMountIds: ['mount-1'],
          scopesByMountId: {
            'mount-1': {
              rootPath: '/repo',
              rootUri: 'file:///repo',
            },
          },
          allowedPluginIds: null,
          capabilities: null,
          trustLevel: null,
        },
        nodeIds: [],
      },
      {
        id: 'child-custom',
        name: 'Custom Child',
        directoryPath: '/repo/packages/app',
        targetMountId: 'mount-1',
        parentSpaceId: 'parent',
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
        nodeIds: [],
      },
    ]

    const result = computeSpaceDirectoryUpdate({
      workspacePath: '/repo',
      spaces,
      spaceId: 'parent',
      directoryPath: '/repo-next',
    })

    const inheritedChild = result?.nextSpaces.find(space => space.id === 'child-inherited')
    const customChild = result?.nextSpaces.find(space => space.id === 'child-custom')

    expect(inheritedChild?.directoryPath).toBe('/repo-next')
    expect(inheritedChild?.boundary?.scopesByMountId['mount-1']).toEqual({
      rootPath: '/repo-next',
      rootUri: 'file:///repo-next',
    })
    expect(customChild?.directoryPath).toBe('/repo/packages/app')
    expect(customChild?.boundary?.scopesByMountId['mount-1']?.rootPath).toBe('/repo/packages/app')
  })
})
