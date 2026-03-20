import { spawn } from 'node:child_process'
import process from 'node:process'
import type { CommandResult } from './githubIntegration.shared'

const DEFAULT_TIMEOUT_MS = 30_000
const HOST_CACHE_TTL_MS = 5 * 60_000
const AUTH_CACHE_TTL_MS = 15_000

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
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finalize = (fn: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      fn()
    }

    timeoutHandle = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore kill errors (process may already be gone).
      }

      finalize(() => {
        reject(new Error(`${command} command timed out`))
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      finalize(() => {
        reject(error)
      })
    })

    child.on('close', exitCode => {
      finalize(() => {
        resolvePromise({
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
          stdout,
          stderr,
        })
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
const repoHostCache = new Map<string, { checkedAt: number; host: string | null }>()
const ghAuthCache = new Map<string, { checkedAt: number; authed: boolean }>()

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
  const host = await resolveGitHubHostForRepo(cwd)
  const cacheKey = host ? `host:${host}` : 'default'

  const now = Date.now()
  const cached = ghAuthCache.get(cacheKey)
  if (cached && now - cached.checkedAt < AUTH_CACHE_TTL_MS) {
    return cached.authed
  }

  try {
    const args = host ? ['auth', 'status', '--hostname', host] : ['auth', 'status']
    const result = await runCommand('gh', args, cwd, {
      timeoutMs: 8_000,
      env: buildGhEnv(),
    })
    const authed = result.exitCode === 0
    ghAuthCache.set(cacheKey, { checkedAt: now, authed })
    return authed
  } catch {
    ghAuthCache.set(cacheKey, { checkedAt: now, authed: false })
    return false
  }
}
async function runGit(repoPath: string, args: string[]): Promise<CommandResult> {
  return await runCommand('git', args, repoPath, {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    timeoutMs: 60_000,
  })
}

async function resolveDefaultRemote(repoPath: string): Promise<string | null> {
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

function parseHostFromGitRemoteUrl(remoteUrl: string): string | null {
  const raw = remoteUrl.trim()
  if (raw.length === 0) {
    return null
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return null
  }

  if (raw.includes('://')) {
    try {
      const parsed = new URL(raw)
      return parsed.hostname.trim() || null
    } catch {
      return null
    }
  }

  const scpStyleMatch = raw.match(/^(?:[^@]+@)?([^:/]+):.+$/)
  return scpStyleMatch?.[1]?.trim() || null
}

async function resolveGitHubHostForRepo(repoPath: string): Promise<string | null> {
  const now = Date.now()
  const cached = repoHostCache.get(repoPath)
  if (cached && now - cached.checkedAt < HOST_CACHE_TTL_MS) {
    return cached.host
  }

  const remote = await resolveDefaultRemote(repoPath)
  if (!remote) {
    repoHostCache.set(repoPath, { checkedAt: now, host: null })
    return null
  }

  const urlResult = await runGit(repoPath, ['remote', 'get-url', remote])
  if (urlResult.exitCode !== 0) {
    repoHostCache.set(repoPath, { checkedAt: now, host: null })
    return null
  }

  const host = parseHostFromGitRemoteUrl(urlResult.stdout.split(/\r?\n/)[0] ?? '')
  repoHostCache.set(repoPath, { checkedAt: now, host })
  return host
}
