import type { GitWorktreeInfo } from '../../../shared/contracts/dto'
import { collectSpaceSubtree } from './spaceTree'
import {
  resolveSpaceOwnWorktree,
  type SpaceWorktreeBinding,
  type SpaceWorktreeRecord,
} from './spaceWorktreeEligibility'

export interface SpaceArchiveScope<TSpace extends SpaceWorktreeRecord> {
  targetSpace: TSpace
  spaces: TSpace[]
  archivedSpaceIds: Set<string>
  archivedNodeIds: Set<string>
  worktreeSpacesInScope: SpaceWorktreeBinding<TSpace>[]
}

export function resolveSpaceArchiveScope<TSpace extends SpaceWorktreeRecord>({
  targetSpace,
  spaces,
  worktrees,
  repoRootPath,
}: {
  targetSpace: TSpace | null
  spaces: TSpace[]
  worktrees: GitWorktreeInfo[]
  repoRootPath: string
}): SpaceArchiveScope<TSpace> | null {
  if (!targetSpace) {
    return null
  }

  const scopedSpaces = collectSpaceSubtree(spaces, targetSpace.id)
  const archivedSpaceIds = new Set(scopedSpaces.map(space => space.id))
  const archivedNodeIds = new Set(scopedSpaces.flatMap(space => space.nodeIds))
  const worktreeSpacesInScope = scopedSpaces
    .map(space => {
      const worktree = resolveSpaceOwnWorktree({ space, spaces, worktrees, repoRootPath })
      return worktree ? { space, worktree } : null
    })
    .filter((binding): binding is SpaceWorktreeBinding<TSpace> => binding !== null)

  return {
    targetSpace,
    spaces: scopedSpaces,
    archivedSpaceIds,
    archivedNodeIds,
    worktreeSpacesInScope,
  }
}
