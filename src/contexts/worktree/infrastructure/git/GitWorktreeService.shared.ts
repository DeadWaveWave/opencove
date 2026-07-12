import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { getCommandExecutionEnvironment } from '../../../../platform/os/CommandEnvironmentService'
import { runCommand } from '../../../../platform/process/runCommand'
import { createAppError } from '../../../../shared/errors/appError'

const DEFAULT_GIT_TIMEOUT_MS = 30_000

export interface GitCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type GitCommandOptions =
  | { intent: 'observation'; timeoutMs?: number }
  | { intent: 'mutation' }

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function runGit(
  args: string[],
  cwd: string,
  options: GitCommandOptions,
): Promise<GitCommandResult> {
  const isObservation = options.intent === 'observation'
  // Windows cannot deliver a graceful SIGTERM to child processes. Never put a fixed force-kill
  // timeout around Git mutations because it can strand required lock files.
  const timeoutMs = isObservation ? (options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS) : null

  try {
    const env = await getCommandExecutionEnvironment({
      GIT_TERMINAL_PROMPT: '0',
      ...(isObservation ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
    })

    const result = await runCommand('git', args, cwd, {
      timeoutMs,
      env,
    })

    return result
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : null
    if (code === 'ENOENT') {
      throw createAppError('worktree.git_unavailable', {
        debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
    }

    throw error
  }
}

export async function ensureGitRepo(repoPath: string): Promise<void> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath, {
    intent: 'observation',
  })
  const isRepo = result.exitCode === 0 && result.stdout.trim() === 'true'

  if (!isRepo) {
    const stderr = normalizeOptionalText(result.stderr) ?? 'Not a git repository'
    if (/xcrun: error: invalid active developer path/i.test(stderr)) {
      throw createAppError('worktree.git_unavailable', { debugMessage: stderr })
    }

    throw createAppError('worktree.not_a_git_repo', {
      debugMessage: stderr,
    })
  }
}

export async function toCanonicalPath(pathValue: string): Promise<string> {
  const normalized = resolve(pathValue)

  try {
    return await realpath(normalized)
  } catch {
    return normalized
  }
}

export async function toCanonicalPathEvenIfMissing(pathValue: string): Promise<string> {
  const normalized = resolve(pathValue)

  try {
    return await realpath(normalized)
  } catch {
    try {
      const parent = await realpath(dirname(normalized))
      return resolve(parent, basename(normalized))
    } catch {
      return normalized
    }
  }
}
