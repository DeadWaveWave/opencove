import { createAppError } from '../../../../shared/errors/appError'
import { runGit } from './GitWorktreeService.shared'

export async function ensureGitRepoHasCommits(repoPath: string): Promise<void> {
  // A repo can be a valid git working tree while still having an "unborn" HEAD (no commits yet).
  // Worktree creation requires a commit-ish to check out, so surface an actionable error early.
  const result = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], repoPath)
  if (result.exitCode === 0) {
    return
  }

  throw createAppError('worktree.repo_has_no_commits', {
    debugMessage: 'git rev-parse --verify HEAD failed; repository has no commits yet',
  })
}
