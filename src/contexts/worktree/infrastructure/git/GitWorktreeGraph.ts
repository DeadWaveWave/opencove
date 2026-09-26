import { isAbsolute } from 'node:path'
import { ensureGitRepo, normalizeOptionalText, runGit } from './GitWorktreeService.shared'
import type { GetGitGraphResult, GitGraphCommit } from '../../../../shared/contracts/dto'

export function parseGitGraphDecorations(value: string): { branch: string | null; refs: string[] } {
  const refs = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.replace(/^HEAD -> /, ''))
  const branch = refs.find(ref => !ref.startsWith('tag: ') && !ref.startsWith('origin/')) ?? null
  return { branch, refs }
}

/**
 * Parse the record stream emitted by the git graph query.
 *
 * Keep this separate from the command execution so callers can validate the
 * wire format without creating a repository or spawning git. The record and
 * field separators are part of the format passed to `git log` below.
 */
export function parseGitGraphLog(stdout: string): GitGraphCommit[] {
  return stdout
    .split('\u001e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [commit, parentsRaw, author, authoredAt, decorations, ...subjectParts] =
        record.split('\u001f')
      const { branch, refs } = parseGitGraphDecorations(decorations ?? '')
      return {
        commit: commit ?? '',
        shortCommit: (commit ?? '').slice(0, 7),
        parents: (parentsRaw ?? '').split(' ').filter(Boolean),
        branch,
        refs,
        author: normalizeOptionalText(author),
        authoredAt: normalizeOptionalText(authoredAt),
        subject: subjectParts.join('\u001f').trim(),
      }
    })
    .filter(commit => commit.commit.length > 0)
}

export async function getGitGraph({
  repoPath,
  limit = 30,
}: {
  repoPath: string
  limit?: number
}): Promise<GetGitGraphResult> {
  const normalizedRepoPath = repoPath.trim()
  if (!normalizedRepoPath || !isAbsolute(normalizedRepoPath)) {
    throw new Error('getGitGraph requires an absolute repoPath')
  }
  await ensureGitRepo(normalizedRepoPath)
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
  const [branchResult, headResult, statusResult, logResult] = await Promise.all([
    runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], normalizedRepoPath, {
      intent: 'observation',
    }),
    runGit(['rev-parse', '--verify', 'HEAD'], normalizedRepoPath, { intent: 'observation' }),
    runGit(['status', '--porcelain=v1', '-b'], normalizedRepoPath, { intent: 'observation' }),
    runGit(
      [
        'log',
        '--all',
        '--topo-order',
        `-${safeLimit}`,
        '--date=iso-strict',
        '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e',
      ],
      normalizedRepoPath,
      { intent: 'observation' },
    ),
  ])

  let ahead = 0
  let behind = 0
  let clean = true
  const statusLines = statusResult.stdout.split(/\r?\n/)
  const header = statusLines[0] ?? ''
  const counts = header.match(/ahead (\d+).*behind (\d+)/)
  if (counts) {
    ahead = Number(counts[1])
    behind = Number(counts[2])
  } else {
    const aheadOnly = header.match(/ahead (\d+)/)
    const behindOnly = header.match(/behind (\d+)/)
    ahead = aheadOnly ? Number(aheadOnly[1]) : 0
    behind = behindOnly ? Number(behindOnly[1]) : 0
  }
  clean = statusLines.slice(1).every(line => line.trim().length === 0)

  const commits = parseGitGraphLog(logResult.stdout)

  return {
    repoPath: normalizedRepoPath,
    branch: branchResult.exitCode === 0 ? normalizeOptionalText(branchResult.stdout) : null,
    head: headResult.exitCode === 0 ? normalizeOptionalText(headResult.stdout) : null,
    detached: branchResult.exitCode !== 0,
    clean,
    ahead,
    behind,
    commits,
  }
}
