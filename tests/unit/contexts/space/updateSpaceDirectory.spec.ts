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
})
