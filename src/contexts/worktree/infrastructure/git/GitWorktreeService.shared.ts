import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { runCommand } from '../../../../platform/process/runCommand'

const DEFAULT_GIT_TIMEOUT_MS = 30_000

export interface GitCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

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
  options: { timeoutMs?: number } = {},
): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS

  const result = await runCommand('git', args, cwd, {
    timeoutMs,
    env: {
      ...process.env,
      // Prevent git from opening an interactive prompt (e.g. auth).
      GIT_TERMINAL_PROMPT: '0',
    },
  })

  return result
}

export async function ensureGitRepo(repoPath: string): Promise<void> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath)
  const isRepo = result.exitCode === 0 && result.stdout.trim() === 'true'

  if (!isRepo) {
    const message = normalizeOptionalText(result.stderr) ?? 'Not a git repository'
    throw new Error(message)
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
