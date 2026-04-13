import { randomBytes } from 'node:crypto'
import {
  ensureGitRepo,
  normalizeOptionalText,
  runGit,
  toCanonicalPath,
  toCanonicalPathEvenIfMissing,
} from './GitWorktreeService.shared'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createAppError, createAppErrorDescriptor } from '../../../../shared/errors/appError'
import {
  cleanupResidualWorktreeDirectory,
  runGitWorktreeRemoveWithRetry,
} from './GitWorktreeRemoveCleanup'
import { ensureGitWorktreeRemovable } from './GitWorktreeRemovePreflight'
import { ensureGitRepoHasCommits } from './GitWorktreeRepoGuards'

export { getGitStatusSummary } from './GitWorktreeStatusSummary'

export interface GitWorktreeEntry {
  path: string
  head: string | null
  branch: string | null
}

export async function listGitBranches({
  repoPath,
}: {
  repoPath: string
}): Promise<{ branches: string[]; current: string | null }> {
  const normalizedRepoPath = repoPath.trim()
  if (normalizedRepoPath.length === 0) {
    throw new Error('listGitBranches requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('listGitBranches requires an absolute repoPath')
  }

  await ensureGitRepo(normalizedRepoPath)

  const currentResult = await runGit(
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    normalizedRepoPath,
  )
  const current = currentResult.exitCode === 0 ? normalizeOptionalText(currentResult.stdout) : null

  const result = await runGit(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    normalizedRepoPath,
  )
  if (result.exitCode !== 0) {
    const stderr = normalizeOptionalText(result.stderr) ?? 'git branch list failed'
    if (/xcrun: error: invalid active developer path/i.test(stderr)) {
      throw createAppError('worktree.git_unavailable', { debugMessage: stderr })
    }
    throw new Error(stderr)
  }

  const branches = result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  return {
    branches: [...new Set(branches)],
    current,
  }
}

export async function listGitWorktrees({
  repoPath,
}: {
  repoPath: string
}): Promise<{ worktrees: GitWorktreeEntry[] }> {
  const normalizedRepoPath = repoPath.trim()
  if (normalizedRepoPath.length === 0) {
    throw new Error('listGitWorktrees requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('listGitWorktrees requires an absolute repoPath')
  }

  await ensureGitRepo(normalizedRepoPath)

  const result = await runGit(['worktree', 'list', '--porcelain'], normalizedRepoPath)
  if (result.exitCode !== 0) {
    throw new Error(normalizeOptionalText(result.stderr) ?? 'git worktree list failed')
  }

  const worktrees: GitWorktreeEntry[] = []
  let current: GitWorktreeEntry | null = null

  const flush = () => {
    if (!current) {
      return
    }

    if (current.path.trim().length === 0) {
      current = null
      return
    }

    worktrees.push(current)
    current = null
  }

  result.stdout.split(/\r?\n/).forEach(line => {
    if (line.trim().length === 0) {
      flush()
      return
    }

    if (line.startsWith('worktree ')) {
      flush()
      current = {
        path: line.slice('worktree '.length).trim(),
        head: null,
        branch: null,
      }
      return
    }

    if (!current) {
      return
    }

    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim()
      return
    }

    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
      return
    }

    if (line.trim() === 'detached') {
      current.branch = null
    }
  })

  flush()

  const normalizedWorktrees = await Promise.all(
    worktrees.map(async entry => ({
      ...entry,
      path: await toCanonicalPath(entry.path),
    })),
  )

  return {
    worktrees: normalizedWorktrees,
  }
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    if (!stats.isDirectory()) {
      return false
    }

    const entries = await readdir(path)
    return entries.length === 0
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const record = error as { code?: unknown }
      if (record.code === 'ENOENT') {
        return true
      }
    }

    throw error
  }
}

export type CreateGitWorktreeBranchMode =
  | { kind: 'new'; name: string; startPoint: string }
  | { kind: 'existing'; name: string }

export interface CreateGitWorktreeInput {
  repoPath: string
  worktreesRoot: string
  branchMode: CreateGitWorktreeBranchMode
}

export interface RemoveGitWorktreeInput {
  repoPath: string
  worktreePath: string
  force?: boolean
  deleteBranch?: boolean
}

export interface RemoveGitWorktreeResult {
  deletedBranchName: string | null
  branchDeleteError: ReturnType<typeof createAppErrorDescriptor> | null
  directoryCleanupError: ReturnType<typeof createAppErrorDescriptor> | null
}

export interface RenameGitBranchInput {
  repoPath: string
  worktreePath: string
  currentName: string
  nextName: string
}

function toSafeWorktreeDirectorySeed(branchName: string): string {
  const slug = branchName
    .trim()
    .toLowerCase()
    .replace(/[\s._/\\]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return slug.length > 0 ? slug : 'worktree'
}

function buildCandidateWorktreeDirectoryName(branchName: string): string {
  return `${toSafeWorktreeDirectorySeed(branchName)}--${randomBytes(4).toString('hex')}`
}

async function assertValidGitBranchName(
  repoPath: string,
  branchName: string,
  label: string,
): Promise<void> {
  const result = await runGit(['check-ref-format', '--branch', branchName], repoPath)
  if (result.exitCode === 0) {
    return
  }

  throw new Error(normalizeOptionalText(result.stderr) ?? `${label} is invalid`)
}

async function allocateWorktreePath({
  worktreesRoot,
  branchName,
  existingWorktrees,
}: {
  worktreesRoot: string
  branchName: string
  existingWorktrees: GitWorktreeEntry[]
}): Promise<string> {
  const canonicalRoot = await toCanonicalPathEvenIfMissing(worktreesRoot)
  const existingPathSet = new Set(existingWorktrees.map(entry => entry.path))

  const candidatePaths = await Promise.all(
    Array.from({ length: 12 }, async () =>
      toCanonicalPathEvenIfMissing(
        resolve(canonicalRoot, buildCandidateWorktreeDirectoryName(branchName)),
      ),
    ),
  )

  const uniqueCandidates = [...new Set(candidatePaths)].filter(
    candidate => !existingPathSet.has(candidate),
  )

  const emptinessChecks = await Promise.all(
    uniqueCandidates.map(async candidate => ({
      candidate,
      isEmpty: await isDirectoryEmpty(candidate),
    })),
  )

  const available = emptinessChecks.find(result => result.isEmpty)
  if (available) {
    return available.candidate
  }

  throw new Error('Unable to allocate a unique worktree directory')
}

export async function createGitWorktree(input: CreateGitWorktreeInput): Promise<GitWorktreeEntry> {
  const normalizedRepoPath = input.repoPath.trim()
  const normalizedWorktreesRoot = input.worktreesRoot.trim()

  if (normalizedRepoPath.length === 0) {
    throw new Error('createGitWorktree requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('createGitWorktree requires an absolute repoPath')
  }

  if (normalizedWorktreesRoot.length === 0) {
    throw new Error('createGitWorktree requires worktreesRoot')
  }

  if (!isAbsolute(normalizedWorktreesRoot)) {
    throw new Error('createGitWorktree requires an absolute worktreesRoot')
  }

  await ensureGitRepo(normalizedRepoPath)
  await ensureGitRepoHasCommits(normalizedRepoPath)

  const worktreesSnapshot = await listGitWorktrees({ repoPath: normalizedRepoPath })

  const branchName = input.branchMode.name.trim()
  if (branchName.length === 0) {
    throw new Error('Branch name cannot be empty')
  }

  await assertValidGitBranchName(normalizedRepoPath, branchName, 'Branch name')

  const branchesSnapshot = await listGitBranches({ repoPath: normalizedRepoPath })
  const branchExists = branchesSnapshot.branches.includes(branchName)
  if (input.branchMode.kind === 'new' && branchExists) {
    throw new Error(`Branch "${branchName}" already exists`)
  }

  if (input.branchMode.kind === 'existing' && !branchExists) {
    throw new Error(`Branch "${branchName}" does not exist`)
  }

  const alreadyCheckedOut = worktreesSnapshot.worktrees.find(entry => entry.branch === branchName)
  if (alreadyCheckedOut) {
    if (input.branchMode.kind === 'existing') {
      return alreadyCheckedOut
    }

    throw new Error(`Branch "${branchName}" is already checked out at ${alreadyCheckedOut.path}`)
  }

  await mkdir(normalizedWorktreesRoot, { recursive: true })

  const comparableWorktreePath = await allocateWorktreePath({
    worktreesRoot: normalizedWorktreesRoot,
    branchName,
    existingWorktrees: worktreesSnapshot.worktrees,
  })

  const args =
    input.branchMode.kind === 'new'
      ? ['worktree', 'add', '-b', branchName, comparableWorktreePath, input.branchMode.startPoint]
      : ['worktree', 'add', comparableWorktreePath, branchName]

  const result = await runGit(args, normalizedRepoPath)
  if (result.exitCode !== 0) {
    throw new Error(normalizeOptionalText(result.stderr) ?? 'git worktree add failed')
  }

  return {
    path: comparableWorktreePath,
    head: null,
    branch: branchName,
  }
}

export async function removeGitWorktree(
  input: RemoveGitWorktreeInput,
): Promise<RemoveGitWorktreeResult> {
  const normalizedRepoPath = input.repoPath.trim()
  const normalizedWorktreePath = input.worktreePath.trim()

  if (normalizedRepoPath.length === 0) {
    throw new Error('removeGitWorktree requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('removeGitWorktree requires an absolute repoPath')
  }

  if (normalizedWorktreePath.length === 0) {
    throw new Error('removeGitWorktree requires worktreePath')
  }

  if (!isAbsolute(normalizedWorktreePath)) {
    throw new Error('removeGitWorktree requires an absolute worktreePath')
  }

  await ensureGitRepo(normalizedRepoPath)

  const comparableRepoPath = await toCanonicalPath(normalizedRepoPath)
  const comparableWorktreePath = await toCanonicalPathEvenIfMissing(normalizedWorktreePath)

  if (comparableWorktreePath === comparableRepoPath) {
    throw new Error('Cannot remove the main worktree')
  }

  const worktreesSnapshot = await listGitWorktrees({ repoPath: normalizedRepoPath })
  const targetWorktree =
    worktreesSnapshot.worktrees.find(entry => entry.path === comparableWorktreePath) ?? null

  if (!targetWorktree) {
    throw new Error('Worktree path is not registered in git worktrees')
  }

  await ensureGitWorktreeRemovable({ worktreePath: targetWorktree.path, force: input.force })

  const args = ['worktree', 'remove']
  if (input.force) {
    args.push('--force')
  }
  args.push(targetWorktree.path)

  const result = await runGitWorktreeRemoveWithRetry(args, normalizedRepoPath)
  const worktreesAfterRemoval = await listGitWorktrees({ repoPath: normalizedRepoPath })
  const isStillRegistered = worktreesAfterRemoval.worktrees.some(
    entry => entry.path === comparableWorktreePath,
  )
  if (isStillRegistered) {
    throw new Error(
      result.exitCode !== 0
        ? (normalizeOptionalText(result.stderr) ?? 'git worktree remove failed')
        : `Worktree "${targetWorktree.path}" is still registered after removal`,
    )
  }

  let deletedBranchName: string | null = null
  let branchDeleteError: ReturnType<typeof createAppErrorDescriptor> | null = null
  const directoryCleanupError = await cleanupResidualWorktreeDirectory(targetWorktree.path)

  if (input.deleteBranch === true && targetWorktree.branch) {
    const deleteBranchResult = await runGit(
      ['branch', '-D', targetWorktree.branch],
      normalizedRepoPath,
    )
    if (deleteBranchResult.exitCode === 0) {
      deletedBranchName = targetWorktree.branch
    } else {
      branchDeleteError = createAppErrorDescriptor('worktree.remove_branch_cleanup_failed', {
        debugMessage:
          normalizeOptionalText(deleteBranchResult.stderr) ??
          `Failed to delete branch "${targetWorktree.branch}"`,
      })
    }
  }

  return {
    deletedBranchName,
    branchDeleteError,
    directoryCleanupError,
  }
}

export async function renameGitBranch(input: RenameGitBranchInput): Promise<void> {
  const normalizedRepoPath = input.repoPath.trim()
  const normalizedWorktreePath = input.worktreePath.trim()
  const currentName = input.currentName.trim()
  const nextName = input.nextName.trim()

  if (normalizedRepoPath.length === 0) {
    throw new Error('renameGitBranch requires repoPath')
  }

  if (!isAbsolute(normalizedRepoPath)) {
    throw new Error('renameGitBranch requires an absolute repoPath')
  }

  if (normalizedWorktreePath.length === 0) {
    throw new Error('renameGitBranch requires worktreePath')
  }

  if (!isAbsolute(normalizedWorktreePath)) {
    throw new Error('renameGitBranch requires an absolute worktreePath')
  }

  if (currentName.length === 0) {
    throw new Error('Current branch name cannot be empty')
  }

  if (nextName.length === 0) {
    throw new Error('Next branch name cannot be empty')
  }

  await ensureGitRepo(normalizedRepoPath)
  await assertValidGitBranchName(normalizedRepoPath, nextName, 'Next branch name')

  const comparableWorktreePath = await toCanonicalPathEvenIfMissing(normalizedWorktreePath)
  const worktreesSnapshot = await listGitWorktrees({ repoPath: normalizedRepoPath })
  const targetWorktree =
    worktreesSnapshot.worktrees.find(entry => entry.path === comparableWorktreePath) ?? null

  if (!targetWorktree) {
    throw new Error('Worktree path is not registered in git worktrees')
  }

  if (targetWorktree.branch !== currentName) {
    throw new Error('Current branch does not match the selected worktree')
  }

  const branchesSnapshot = await listGitBranches({ repoPath: normalizedRepoPath })
  if (!branchesSnapshot.branches.includes(currentName)) {
    throw new Error(`Branch "${currentName}" does not exist`)
  }

  if (branchesSnapshot.branches.includes(nextName)) {
    throw new Error(`Branch "${nextName}" already exists`)
  }

  const result = await runGit(['branch', '-m', currentName, nextName], comparableWorktreePath)
  if (result.exitCode !== 0) {
    throw new Error(normalizeOptionalText(result.stderr) ?? 'git branch rename failed')
  }
}
