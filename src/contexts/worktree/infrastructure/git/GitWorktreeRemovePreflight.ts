import { stat } from 'node:fs/promises'
import { createAppError } from '../../../../shared/errors/appError'
import { getGitStatusSummary } from './GitWorktreeStatusSummary'

export async function ensureGitWorktreeRemovable({
  worktreePath,
  force,
}: {
  worktreePath: string
  force?: boolean
}): Promise<void> {
  if (force === true) {
    return
  }

  let changedFileCount: number | null = null
  try {
    const stats = await stat(worktreePath)
    if (stats.isDirectory()) {
      const statusSummary = await getGitStatusSummary({ repoPath: worktreePath })
      changedFileCount = statusSummary.changedFileCount
    }
  } catch {
    changedFileCount = null
  }

  if (changedFileCount !== null && changedFileCount > 0) {
    throw createAppError('worktree.remove_uncommitted_changes', {
      params: { changedFileCount },
      debugMessage: `Worktree "${worktreePath}" has ${changedFileCount} changed file(s)`,
    })
  }
}
