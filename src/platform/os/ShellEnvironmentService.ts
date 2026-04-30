import { execFile } from 'node:child_process'
import process from 'node:process'

const SHELL_ENV_MARKER = '__OPENCOVE_SHELL_ENV_MARKER__'
const SHELL_CAPTURE_TIMEOUT_MS = 2_000
const DEFAULT_POSIX_SHELL = '/bin/zsh'
const POSIX_FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash']
const ANSI_ESCAPE_PATTERN =
  // Strip common ANSI color/control sequences that shell prompts may emit.
  new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g')

export type ShellEnvironmentSource =
  | 'process_env'
  | 'default_shell'
  | 'fallback_shell'
  | 'explicit_shell'

export interface ShellEnvironmentSnapshot {
  env: NodeJS.ProcessEnv
  shellPath: string | null
  source: ShellEnvironmentSource
  diagnostics: string[]
}

let cachedShellEnvironmentPromise: Promise<ShellEnvironmentSnapshot> | null = null

function normalizeShellPath(shellPath: string | undefined): string {
  const normalized = shellPath?.trim() ?? ''
  return normalized.length > 0 ? normalized : DEFAULT_POSIX_SHELL
}

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_PATTERN, '')
}

function parseShellEnvironment(stdout: string): NodeJS.ProcessEnv | null {
  const start = stdout.indexOf(SHELL_ENV_MARKER)
  if (start < 0) {
    return null
  }

  const from = start + SHELL_ENV_MARKER.length
  const end = stdout.indexOf(SHELL_ENV_MARKER, from)
  if (end < 0) {
    return null
  }

  const payload = stdout.slice(from, end)
  const env: NodeJS.ProcessEnv = {}

  for (const rawLine of stripAnsi(payload).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (key.length === 0) {
      continue
    }

    env[key] = line.slice(separatorIndex + 1)
  }

  return Object.keys(env).length > 0 ? env : null
}

async function captureEnvironmentFromShell(
  shellPath: string,
): Promise<{ env: NodeJS.ProcessEnv | null; diagnostics: string[] }> {
  return await new Promise(resolveCapture => {
    execFile(
      shellPath,
      ['-ilc', `printf '${SHELL_ENV_MARKER}'; command env; printf '${SHELL_ENV_MARKER}'; exit`],
      {
        encoding: 'utf8',
        timeout: SHELL_CAPTURE_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTARTED: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const diagnostics = [`Shell env capture failed for ${shellPath}: ${error.message}`]
          const stderrText = typeof stderr === 'string' ? stderr.trim() : ''
          if (stderrText.length > 0) {
            diagnostics.push(`stderr: ${stderrText}`)
          }

          resolveCapture({ env: null, diagnostics })
          return
        }

        const parsed = parseShellEnvironment(typeof stdout === 'string' ? stdout : String(stdout))
        if (!parsed) {
          resolveCapture({
            env: null,
            diagnostics: [`Shell env capture produced no parseable payload for ${shellPath}.`],
          })
          return
        }

        resolveCapture({ env: parsed, diagnostics: [] })
      },
    )
  })
}

async function resolveShellEnvironmentSnapshot(
  explicitShellPath?: string,
): Promise<ShellEnvironmentSnapshot> {
  if (process.platform === 'win32') {
    return {
      env: { ...process.env },
      shellPath: null,
      source: 'process_env',
      diagnostics: ['Windows uses the current process environment without shell capture.'],
    }
  }

  const diagnostics: string[] = []
  const primaryShell = normalizeShellPath(explicitShellPath ?? process.env.SHELL)
  const shellCandidates = [
    primaryShell,
    ...POSIX_FALLBACK_SHELLS.filter(shellPath => shellPath !== primaryShell),
  ]

  const captures = await Promise.all(
    shellCandidates.map(async shellPath => ({
      shellPath,
      captured: await captureEnvironmentFromShell(shellPath),
    })),
  )

  for (let index = 0; index < captures.length; index += 1) {
    const { shellPath, captured } = captures[index]
    diagnostics.push(...captured.diagnostics)

    if (!captured.env) {
      continue
    }

    return {
      env: captured.env,
      shellPath,
      source:
        explicitShellPath && explicitShellPath.trim().length > 0
          ? 'explicit_shell'
          : index === 0
            ? 'default_shell'
            : 'fallback_shell',
      diagnostics,
    }
  }

  diagnostics.push('Falling back to the current process environment.')
  return {
    env: { ...process.env },
    shellPath: primaryShell,
    source: 'process_env',
    diagnostics,
  }
}

function cloneSnapshot(snapshot: ShellEnvironmentSnapshot): ShellEnvironmentSnapshot {
  return {
    env: { ...snapshot.env },
    shellPath: snapshot.shellPath,
    source: snapshot.source,
    diagnostics: [...snapshot.diagnostics],
  }
}

export async function getShellEnvironmentSnapshot(
  explicitShellPath?: string,
): Promise<ShellEnvironmentSnapshot> {
  if (explicitShellPath && explicitShellPath.trim().length > 0) {
    return await resolveShellEnvironmentSnapshot(explicitShellPath)
  }

  if (!cachedShellEnvironmentPromise) {
    cachedShellEnvironmentPromise = resolveShellEnvironmentSnapshot()
  }

  return cloneSnapshot(await cachedShellEnvironmentPromise)
}

export function disposeShellEnvironmentService(): void {
  cachedShellEnvironmentPromise = null
}
