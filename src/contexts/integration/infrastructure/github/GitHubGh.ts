import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import type { GitHubPullRequestSelector } from '../../../../shared/contracts/dto'
import type { CommandResult } from './githubIntegration.shared'
import { normalizeText } from './githubIntegration.shared'

const DEFAULT_TIMEOUT_MS = 30_000

export function buildGhEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: {
    timeoutMs?: number
    stdin?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      clearTimeout(timeoutHandle)
      reject(error)
    })

    child.on('close', exitCode => {
      clearTimeout(timeoutHandle)

      if (timedOut) {
        reject(new Error(`${command} command timed out`))
        return
      }

      resolvePromise({
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        stdout,
        stderr,
      })
    })

    const stdin = options.stdin
    if (typeof stdin === 'string' && stdin.length > 0) {
      child.stdin.write(stdin)
    }

    child.stdin.end()
  })
}

let ghExistsCache: { checkedAt: number; exists: boolean } | null = null

export async function isGhAvailable(cwd: string): Promise<boolean> {
  const now = Date.now()
  if (ghExistsCache && now - ghExistsCache.checkedAt < 30_000) {
    return ghExistsCache.exists
  }

  try {
    const result = await runCommand('gh', ['--version'], cwd, {
      timeoutMs: 5_000,
      env: buildGhEnv(),
    })
    const exists = result.exitCode === 0
    ghExistsCache = { checkedAt: now, exists }
    return exists
  } catch {
    ghExistsCache = { checkedAt: now, exists: false }
    return false
  }
}

export async function isGhAuthenticated(cwd: string): Promise<boolean> {
  try {
    const result = await runCommand('gh', ['auth', 'status', '--json', 'hosts'], cwd, {
      timeoutMs: 8_000,
      env: buildGhEnv(),
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}

export function selectorToGhArg(selector: GitHubPullRequestSelector): string {
  if (selector.kind === 'branch') {
    return selector.branch
  }

  if (selector.kind === 'number') {
    return String(selector.number)
  }

  return selector.url
}

export function parsePrUrlFromOutput(raw: string): string | null {
  const match = raw.match(/https?:\/\/\S+/)
  return match ? match[0] : null
}

export async function runGhWithBodyFile(
  repoPath: string,
  args: string[],
  body: string,
): Promise<CommandResult> {
  const filePath = join(tmpdir(), `cove-gh-body-${randomUUID()}.txt`)
  try {
    await writeFile(filePath, body, 'utf8')
    return await runCommand('gh', [...args, '--body-file', filePath], repoPath, {
      env: buildGhEnv(),
      timeoutMs: 60_000,
    })
  } finally {
    await rm(filePath, { force: true }).catch(() => undefined)
  }
}

export async function runGit(repoPath: string, args: string[]): Promise<CommandResult> {
  return await runCommand('git', args, repoPath, {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    timeoutMs: 60_000,
  })
}

export async function resolveDefaultRemote(repoPath: string): Promise<string | null> {
  const result = await runGit(repoPath, ['remote'])
  if (result.exitCode !== 0) {
    return null
  }

  const remotes = result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (remotes.includes('origin')) {
    return 'origin'
  }

  return remotes[0] ?? null
}

export function formatCommandError(result: CommandResult, fallback: string): string {
  return normalizeText(result.stderr) || fallback
}
