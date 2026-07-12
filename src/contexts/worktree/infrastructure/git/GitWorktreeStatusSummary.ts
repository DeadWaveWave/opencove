import { isAbsolute } from 'node:path'
import { ensureGitRepo, normalizeOptionalText, runGit } from './GitWorktreeService.shared'

export async function getGitStatusSummary({
  repoPath,
}: {
  repoPath: string
}): Promise<{ changedFileCount: number }> {
  const normalizedRepoPath = repoPath.trim()
  if (normalizedRepoPath.length === 0) {
    throw new Error('getGitStatusSummary requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('getGitStatusSummary requires an absolute repoPath')
  }

  await ensureGitRepo(normalizedRepoPath)

  // This runs from background polling. Observation intent prevents Git's optional index refresh
  // from contending with user-initiated checkout/add/commit operations.
  const result = await runGit(
    ['status', '--porcelain', '--untracked-files=all'],
    normalizedRepoPath,
    { intent: 'observation' },
  )
  if (result.exitCode !== 0) {
    throw new Error(normalizeOptionalText(result.stderr) ?? 'git status failed')
  }

  const changedFiles = new Set<string>()

  result.stdout.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      return
    }

    const pathPortion = line.slice(3).trim()
    if (pathPortion.length === 0) {
      return
    }

    const normalizedPath = pathPortion.includes(' -> ')
      ? (pathPortion.split(' -> ').at(-1)?.trim() ?? pathPortion)
      : pathPortion

    if (normalizedPath.length > 0) {
      changedFiles.add(normalizedPath)
    }
  })

  return {
    changedFileCount: changedFiles.size,
  }
}
