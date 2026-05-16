import type { GitWorktreeInfo } from '../../../shared/contracts/dto'
import { normalizeComparablePath } from './spaceBoundaryPolicy'
import { collectAncestorSpaces, collectSpaceSubtree } from './spaceTree'

export interface SpaceWorktreeRecord {
  id: string
  directoryPath: string
  targetMountId?: string | null
  parentSpaceId?: string | null
  nodeIds: string[]
}

export type SpaceWorktreeEligibilityReason =
  | 'space_not_found'
  | 'already_worktree'
  | 'worktree_ancestor'
  | 'worktree_descendant'

export interface SpaceWorktreeBinding<TSpace extends SpaceWorktreeRecord> {
  space: TSpace
  worktree: GitWorktreeInfo
}

export interface SpaceWorktreeEligibility<TSpace extends SpaceWorktreeRecord> {
  canCreate: boolean
  reason: SpaceWorktreeEligibilityReason | null
  ownWorktree: GitWorktreeInfo | null
  ancestorWorktree: SpaceWorktreeBinding<TSpace> | null
  descendantWorktree: SpaceWorktreeBinding<TSpace> | null
}

function normalizePath(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? normalizeComparablePath(trimmed) : ''
}

export function resolveSpaceOwnWorktree<TSpace extends SpaceWorktreeRecord>({
  space,
  spaces,
  worktrees,
  repoRootPath,
}: {
  space: TSpace | null
  spaces?: TSpace[]
  worktrees: GitWorktreeInfo[]
  repoRootPath: string
}): GitWorktreeInfo | null {
  if (!space) {
    return null
  }

  const normalizedDirectory = normalizePath(space.directoryPath)
  const normalizedRepoRoot = normalizePath(repoRootPath)
  if (!normalizedDirectory || normalizedDirectory === normalizedRepoRoot) {
    return null
  }

  const inheritedFromAncestor = spaces
    ? collectAncestorSpaces(spaces, space.id).some(
        ancestor => normalizePath(ancestor.directoryPath) === normalizedDirectory,
      )
    : false
  if (inheritedFromAncestor) {
    return null
  }

  return worktrees.find(entry => normalizePath(entry.path) === normalizedDirectory) ?? null
}

export function resolveSpaceWorktreeBindings<TSpace extends SpaceWorktreeRecord>({
  spaces,
  worktrees,
  repoRootPath,
}: {
  spaces: TSpace[]
  worktrees: GitWorktreeInfo[]
  repoRootPath: string
}): SpaceWorktreeBinding<TSpace>[] {
  return spaces
    .map(space => {
      const worktree = resolveSpaceOwnWorktree({ space, spaces, worktrees, repoRootPath })
      return worktree ? { space, worktree } : null
    })
    .filter((binding): binding is SpaceWorktreeBinding<TSpace> => binding !== null)
}

export function getSpaceWorktreeEligibility<TSpace extends SpaceWorktreeRecord>({
  space,
  spaces,
  worktrees,
  repoRootPath,
}: {
  space: TSpace | null
  spaces: TSpace[]
  worktrees: GitWorktreeInfo[]
  repoRootPath: string
}): SpaceWorktreeEligibility<TSpace> {
  const empty = {
    canCreate: false,
    reason: 'space_not_found' as const,
    ownWorktree: null,
    ancestorWorktree: null,
    descendantWorktree: null,
  }
  if (!space) {
    return empty
  }

  const ownWorktree = resolveSpaceOwnWorktree({ space, spaces, worktrees, repoRootPath })
  if (ownWorktree) {
    return {
      canCreate: false,
      reason: 'already_worktree',
      ownWorktree,
      ancestorWorktree: null,
      descendantWorktree: null,
    }
  }

  const bindings = resolveSpaceWorktreeBindings({ spaces, worktrees, repoRootPath })
  const bindingBySpaceId = new Map(bindings.map(binding => [binding.space.id, binding] as const))

  const ancestorWorktree =
    collectAncestorSpaces(spaces, space.id)
      .map(ancestor => bindingBySpaceId.get(ancestor.id) ?? null)
      .find((binding): binding is SpaceWorktreeBinding<TSpace> => binding !== null) ?? null
  if (ancestorWorktree) {
    return {
      canCreate: false,
      reason: 'worktree_ancestor',
      ownWorktree: null,
      ancestorWorktree,
      descendantWorktree: null,
    }
  }

  const descendantWorktree =
    collectSpaceSubtree(spaces, space.id)
      .filter(candidate => candidate.id !== space.id)
      .map(descendant => bindingBySpaceId.get(descendant.id) ?? null)
      .find((binding): binding is SpaceWorktreeBinding<TSpace> => binding !== null) ?? null
  if (descendantWorktree) {
    return {
      canCreate: false,
      reason: 'worktree_descendant',
      ownWorktree: null,
      ancestorWorktree: null,
      descendantWorktree,
    }
  }

  return {
    canCreate: true,
    reason: null,
    ownWorktree: null,
    ancestorWorktree: null,
    descendantWorktree: null,
  }
}
