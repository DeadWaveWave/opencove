import { describe, expect, it } from 'vitest'
import type { GitWorktreeInfo } from '../../../../src/shared/contracts/dto'
import {
  getSpaceWorktreeEligibility,
  resolveSpaceOwnWorktree,
  type SpaceWorktreeRecord,
} from '../../../../src/contexts/space/application/spaceWorktreeEligibility'

function createSpace(
  id: string,
  directoryPath: string,
  parentSpaceId: string | null = null,
): SpaceWorktreeRecord {
  return {
    id,
    directoryPath,
    targetMountId: null,
    parentSpaceId,
    nodeIds: [],
  }
}

function worktree(path: string, branch = 'feature/demo'): GitWorktreeInfo {
  return { path, branch, head: null }
}

describe('spaceWorktreeEligibility', () => {
  it('does not treat an ordinary child sharing the parent directory as its own worktree', () => {
    const parent = createSpace('parent', '/repo')
    const child = createSpace('child', '/repo', 'parent')
    const spaces = [parent, child]

    expect(
      resolveSpaceOwnWorktree({
        space: child,
        spaces,
        worktrees: [worktree('/repo')],
        repoRootPath: '/repo',
      }),
    ).toBeNull()
    expect(
      getSpaceWorktreeEligibility({
        space: child,
        spaces,
        worktrees: [worktree('/repo')],
        repoRootPath: '/repo',
      }).canCreate,
    ).toBe(true)
  })

  it('blocks descendant conversion when an ancestor Space owns a worktree', () => {
    const parent = createSpace('parent', '/repo/.opencove/worktrees/backend')
    const child = createSpace('child', '/repo/.opencove/worktrees/backend', 'parent')

    const result = getSpaceWorktreeEligibility({
      space: child,
      spaces: [parent, child],
      worktrees: [worktree('/repo/.opencove/worktrees/backend', 'space/backend')],
      repoRootPath: '/repo',
    })

    expect(result).toMatchObject({
      canCreate: false,
      reason: 'worktree_ancestor',
      ancestorWorktree: { space: { id: 'parent' } },
    })
  })

  it('blocks ancestor conversion when a descendant Space owns a worktree', () => {
    const parent = createSpace('parent', '/repo')
    const child = createSpace('child', '/repo/.opencove/worktrees/api', 'parent')

    const result = getSpaceWorktreeEligibility({
      space: parent,
      spaces: [parent, child],
      worktrees: [worktree('/repo/.opencove/worktrees/api', 'space/api')],
      repoRootPath: '/repo',
    })

    expect(result).toMatchObject({
      canCreate: false,
      reason: 'worktree_descendant',
      descendantWorktree: { space: { id: 'child' } },
    })
  })

  it('allows sibling child Spaces to independently become worktrees', () => {
    const parent = createSpace('parent', '/repo')
    const childA = createSpace('child-a', '/repo/.opencove/worktrees/api', 'parent')
    const childB = createSpace('child-b', '/repo', 'parent')

    const result = getSpaceWorktreeEligibility({
      space: childB,
      spaces: [parent, childA, childB],
      worktrees: [worktree('/repo/.opencove/worktrees/api', 'space/api')],
      repoRootPath: '/repo',
    })

    expect(result).toMatchObject({ canCreate: true, reason: null })
  })
})
