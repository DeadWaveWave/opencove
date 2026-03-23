import { isAbsolute } from 'node:path'
import { ensureGitRepo, normalizeOptionalText, runGit } from './GitWorktreeService.shared'

function parseRemoteHeadRef(remote: string, value: string): string | null {
  const trimmed = value.trim()
  const prefix = `refs/remotes/${remote}/`
  if (!trimmed.startsWith(prefix)) {
    return null
  }

  const branch = trimmed.slice(prefix.length).trim()
  return branch.length > 0 ? branch : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return [...new Set(normalized)]
}

async function listGitRemotes(repoPath: string): Promise<string[]> {
  const result = await runGit(['remote'], repoPath)
  if (result.exitCode !== 0) {
    return []
  }

  return normalizeStringArray(result.stdout.split(/\r?\n/))
}

async function doesGitRefExist(repoPath: string, ref: string): Promise<boolean> {
  const result = await runGit(['show-ref', '--verify', '--quiet', ref], repoPath)
  return result.exitCode === 0
}

async function resolveRemoteHeadBranch(repoPath: string, remote: string): Promise<string | null> {
  const symbolicRef = await runGit(
    ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`],
    repoPath,
  )

  if (symbolicRef.exitCode === 0) {
    const parsed = parseRemoteHeadRef(remote, symbolicRef.stdout)
    if (parsed) {
      return parsed
    }
  }

  const showRemote = await runGit(['remote', 'show', '-n', remote], repoPath, { timeoutMs: 10_000 })
  if (showRemote.exitCode === 0) {
    const match = showRemote.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.startsWith('HEAD branch:'))

    if (match) {
      const branch = match.slice('HEAD branch:'.length).trim()
      if (branch.length > 0) {
        return branch
      }
    }
  }

  return null
}

export async function getGitDefaultBranch({
  repoPath,
}: {
  repoPath: string
}): Promise<string | null> {
  const normalizedRepoPath = repoPath.trim()
  if (normalizedRepoPath.length === 0) {
    throw new Error('getGitDefaultBranch requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('getGitDefaultBranch requires an absolute repoPath')
  }

  await ensureGitRepo(normalizedRepoPath)

  const remotes = await listGitRemotes(normalizedRepoPath)
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)

  if (remote) {
    const remoteHead = await resolveRemoteHeadBranch(normalizedRepoPath, remote)
    if (remoteHead) {
      return remoteHead
    }
  }

  const candidates = ['main', 'master']
  const candidateChecks = await Promise.all(
    candidates.map(async candidate => ({
      candidate,
      remoteExists: remote
        ? await doesGitRefExist(normalizedRepoPath, `refs/remotes/${remote}/${candidate}`)
        : false,
      localExists: await doesGitRefExist(normalizedRepoPath, `refs/heads/${candidate}`),
    })),
  )

  for (const candidate of candidates) {
    const check = candidateChecks.find(entry => entry.candidate === candidate)
    if (check?.remoteExists || check?.localExists) {
      return candidate
    }
  }

  const currentBranchResult = await runGit(['branch', '--show-current'], normalizedRepoPath)
  if (currentBranchResult.exitCode === 0) {
    const current = normalizeOptionalText(currentBranchResult.stdout)
    if (current) {
      return current
    }
  }

  return null
}
