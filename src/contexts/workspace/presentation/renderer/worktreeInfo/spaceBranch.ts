import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { resolveWorktreeRepoRootPath } from '@contexts/worktree/presentation/renderer/windows/spaceWorktree.shared'
import {
  normalizeComparablePath,
  resolveClosestWorktree,
  toShortSha,
} from '../components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay.helpers'

export interface SpaceBranch {
  kind: 'branch' | 'detached'
  /** What to show: the branch, or a detached worktree's short commit. */
  value: string
  title: string
}

/**
 * The branch a Space works on, when its directory is in a worktree of its own. A Space in the
 * project's own checkout shares the project's branch, so it names none.
 */
export function resolveSpaceBranch(
  worktrees: GitWorktreeInfo[],
  workspacePath: string,
  directoryPath: string,
): SpaceBranch | null {
  const worktree = resolveClosestWorktree(worktrees, directoryPath)
  if (!worktree) {
    return null
  }
  const root = normalizeComparablePath(resolveWorktreeRepoRootPath(workspacePath, worktrees))
  if (normalizeComparablePath(worktree.path) === root) {
    return null
  }
  if (worktree.branch) {
    return { kind: 'branch', value: worktree.branch, title: worktree.branch }
  }
  return worktree.head
    ? { kind: 'detached', value: toShortSha(worktree.head), title: worktree.head }
    : null
}

/** The branch the project's own checkout is on (the sidebar header's "project · branch"). */
export function resolveProjectBranch(
  worktrees: GitWorktreeInfo[],
  workspacePath: string,
): SpaceBranch | null {
  const root = normalizeComparablePath(workspacePath)
  const worktree = worktrees.find(entry => normalizeComparablePath(entry.path) === root)
  if (!worktree) {
    return null
  }
  if (worktree.branch) {
    return { kind: 'branch', value: worktree.branch, title: worktree.branch }
  }
  return worktree.head
    ? { kind: 'detached', value: toShortSha(worktree.head), title: worktree.head }
    : null
}
