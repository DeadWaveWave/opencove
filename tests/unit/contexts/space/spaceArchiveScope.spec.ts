import { describe, expect, it } from 'vitest'
import type { GitWorktreeInfo } from '../../../../src/shared/contracts/dto'
import { resolveSpaceArchiveScope } from '../../../../src/contexts/space/application/spaceArchiveScope'
import type { SpaceWorktreeRecord } from '../../../../src/contexts/space/application/spaceWorktreeEligibility'

function createSpace(options: {
  id: string
  directoryPath: string
  parentSpaceId?: string | null
  nodeIds?: string[]
}): SpaceWorktreeRecord {
  return {
    id: options.id,
    directoryPath: options.directoryPath,
    targetMountId: null,
    parentSpaceId: options.parentSpaceId ?? null,
    nodeIds: options.nodeIds ?? [],
  }
}

function worktree(path: string, branch = 'space/demo'): GitWorktreeInfo {
  return { path, branch, head: null }
}

describe('spaceArchiveScope', () => {
  it('archives the target Space subtree and only subtree-owned nodes', () => {
    const parent = createSpace({ id: 'parent', directoryPath: '/repo', nodeIds: ['node-a'] })
    const child = createSpace({
      id: 'child',
      directoryPath: '/repo',
      parentSpaceId: 'parent',
      nodeIds: ['node-b'],
    })
    const sibling = createSpace({ id: 'sibling', directoryPath: '/repo', nodeIds: ['node-c'] })

    const scope = resolveSpaceArchiveScope({
      targetSpace: parent,
      spaces: [parent, child, sibling],
      worktrees: [],
      repoRootPath: '/repo',
    })

    expect(scope?.spaces.map(space => space.id)).toEqual(['parent', 'child'])
    expect(scope?.archivedSpaceIds).toEqual(new Set(['parent', 'child']))
    expect(scope?.archivedNodeIds).toEqual(new Set(['node-a', 'node-b']))
  })

  it('reports explicit descendant worktrees without treating inherited directories as worktrees', () => {
    const parent = createSpace({ id: 'parent', directoryPath: '/repo', nodeIds: ['node-a'] })
    const ordinaryChild = createSpace({
      id: 'ordinary-child',
      directoryPath: '/repo',
      parentSpaceId: 'parent',
      nodeIds: ['node-b'],
    })
    const worktreeChild = createSpace({
      id: 'worktree-child',
      directoryPath: '/repo/.opencove/worktrees/api',
      parentSpaceId: 'parent',
      nodeIds: ['node-c'],
    })

    const scope = resolveSpaceArchiveScope({
      targetSpace: parent,
      spaces: [parent, ordinaryChild, worktreeChild],
      worktrees: [worktree('/repo'), worktree('/repo/.opencove/worktrees/api', 'space/api')],
      repoRootPath: '/repo',
    })

    expect(scope?.worktreeSpacesInScope.map(binding => binding.space.id)).toEqual([
      'worktree-child',
    ])
  })
})
