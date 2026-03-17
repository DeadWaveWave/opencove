import { rm, stat } from 'node:fs/promises'
import type { AppErrorDescriptor } from '../../../../shared/contracts/dto/error'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'
import { runGit } from './GitWorktreeService.shared'

const WORKTREE_DIRECTORY_CLEANUP_MAX_ATTEMPTS = 6
const WORKTREE_DIRECTORY_CLEANUP_RETRY_MS = 150

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const record = error as { code?: unknown }
      if (record.code === 'ENOENT') {
        return false
      }
    }

    throw error
  }
}

function toErrorDebugMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return undefined
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolvePromise => {
    setTimeout(resolvePromise, ms)
  })
}

export async function cleanupResidualWorktreeDirectory(
  worktreePath: string,
): Promise<AppErrorDescriptor | null> {
  return await cleanupResidualWorktreeDirectoryAttempt(worktreePath, 0, null)
}

function shouldRetryGitWorktreeRemove(stderr: string): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  const normalized = stderr.toLowerCase()
  return normalized.includes('permission denied') || normalized.includes('failed to delete')
}

export async function runGitWorktreeRemoveWithRetry(
  args: string[],
  repoPath: string,
): Promise<Awaited<ReturnType<typeof runGit>>> {
  const initialResult = await runGit(args, repoPath)
  if (initialResult.exitCode === 0 || !shouldRetryGitWorktreeRemove(initialResult.stderr)) {
    return initialResult
  }

  return await runGitWorktreeRemoveWithRetryAttempt(args, repoPath, 1)
}

async function cleanupResidualWorktreeDirectoryAttempt(
  worktreePath: string,
  attempt: number,
  lastError: unknown,
): Promise<AppErrorDescriptor | null> {
  if (!(await pathExists(worktreePath))) {
    return null
  }

  let nextLastError = lastError
  try {
    await rm(worktreePath, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: WORKTREE_DIRECTORY_CLEANUP_RETRY_MS,
    })
  } catch (error) {
    nextLastError = error
  }

  if (!(await pathExists(worktreePath))) {
    return null
  }

  if (attempt >= WORKTREE_DIRECTORY_CLEANUP_MAX_ATTEMPTS - 1) {
    return createAppErrorDescriptor('worktree.remove_directory_cleanup_failed', {
      debugMessage:
        toErrorDebugMessage(nextLastError) ??
        `Worktree directory "${worktreePath}" still exists after git worktree remove`,
    })
  }

  await delay(WORKTREE_DIRECTORY_CLEANUP_RETRY_MS * (attempt + 1))
  return await cleanupResidualWorktreeDirectoryAttempt(worktreePath, attempt + 1, nextLastError)
}

async function runGitWorktreeRemoveWithRetryAttempt(
  args: string[],
  repoPath: string,
  attempt: number,
): Promise<Awaited<ReturnType<typeof runGit>>> {
  await delay(WORKTREE_DIRECTORY_CLEANUP_RETRY_MS * attempt)
  const result = await runGit(args, repoPath)
  if (result.exitCode === 0 || !shouldRetryGitWorktreeRemove(result.stderr) || attempt >= 4) {
    return result
  }

  return await runGitWorktreeRemoveWithRetryAttempt(args, repoPath, attempt + 1)
}
