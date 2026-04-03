import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { resolveHomeDirectory } from './HomeDirectory'

const POSIX_FALLBACK_PATH_SEGMENTS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

const PATH_MARKER = '__OPENCOVE_PATH_MARKER__'
const LOCALE_MARKER = '__OPENCOVE_LOCALE_MARKER__'

interface ComputeHydratedCliPathInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentPath: string
  homeDir: string
  shellPathFromLogin: string
}

interface ComputeHydratedLocaleEnvInput {
  platform: NodeJS.Platform
  currentEnv: NodeJS.ProcessEnv
  loginShellEnv: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>
}

type LoginShellLocaleEnv = Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>

function splitPath(pathValue: string, delimiter: string): string[] {
  if (pathValue.trim().length === 0) {
    return []
  }

  return pathValue
    .split(delimiter)
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

function dedupePathSegments(segments: string[]): string[] {
  const unique: string[] = []

  for (const segment of segments) {
    if (segment.length === 0 || unique.includes(segment)) {
      continue
    }

    unique.push(segment)
  }

  return unique
}

function resolvePosixShellPath(shellPath: string | undefined): string {
  const normalized = typeof shellPath === 'string' ? shellPath.trim() : ''
  return normalized.length > 0 ? normalized : '/bin/zsh'
}

function readLoginShellPath(shellPath: string): string {
  try {
    const output = execFileSync(
      shellPath,
      ['-l', '-c', `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )

    const start = output.indexOf(PATH_MARKER)
    if (start < 0) {
      return ''
    }

    const from = start + PATH_MARKER.length
    const end = output.indexOf(PATH_MARKER, from)
    if (end < 0) {
      return ''
    }

    return output.slice(from, end).trim()
  } catch {
    return ''
  }
}

function parseLoginShellLocaleOutput(output: string): LoginShellLocaleEnv {
  const lines = output.split(/\r?\n/)
  const values = new Map<string, string>()

  for (const line of lines) {
    if (!line.startsWith(`${LOCALE_MARKER}:`)) {
      continue
    }

    const payload = line.slice(LOCALE_MARKER.length + 1)
    const separatorIndex = payload.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = payload.slice(0, separatorIndex).trim()
    const value = payload.slice(separatorIndex + 1).trim()
    if (key === 'LANG' || key === 'LC_ALL' || key === 'LC_CTYPE') {
      values.set(key, value)
    }
  }

  return {
    LANG: values.get('LANG'),
    LC_ALL: values.get('LC_ALL'),
    LC_CTYPE: values.get('LC_CTYPE'),
  }
}

function readLoginShellLocaleEnv(shellPath: string): LoginShellLocaleEnv {
  try {
    const output = execFileSync(
      shellPath,
      [
        '-l',
        '-c',
        `printf '${LOCALE_MARKER}:LANG=%s\\n' "$LANG"; printf '${LOCALE_MARKER}:LC_ALL=%s\\n' "$LC_ALL"; printf '${LOCALE_MARKER}:LC_CTYPE=%s\\n' "$LC_CTYPE"`,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )

    return parseLoginShellLocaleOutput(output)
  } catch {
    return {}
  }
}

function isUtf8Locale(value: string | undefined): boolean {
  return typeof value === 'string' && /utf-?8/i.test(value)
}

function resolveEffectiveCharacterLocale(
  env: NodeJS.ProcessEnv | Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>,
): string {
  const lcAll = env.LC_ALL?.trim()
  if (lcAll) {
    return lcAll
  }

  const lcCtype = env.LC_CTYPE?.trim()
  if (lcCtype) {
    return lcCtype
  }

  return env.LANG?.trim() ?? ''
}

function resolveUtf8LocaleFallback(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
}

function buildAdditionalPathSegments(platform: NodeJS.Platform, homeDir: string): string[] {
  if (platform === 'win32') {
    return []
  }

  const segments: string[] = []
  if (homeDir.trim().length > 0) {
    segments.push(`${homeDir}/.local/bin`)
    segments.push(`${homeDir}/bin`)
  }

  segments.push(...POSIX_FALLBACK_PATH_SEGMENTS)
  return segments
}

export function computeHydratedCliPath(input: ComputeHydratedCliPathInput): string {
  const delimiter = input.platform === 'win32' ? ';' : ':'

  if (!input.isPackaged) {
    return input.currentPath
  }

  const currentSegments = splitPath(input.currentPath, delimiter)
  const shellSegments = splitPath(input.shellPathFromLogin, delimiter)
  const additionalSegments = buildAdditionalPathSegments(input.platform, input.homeDir)
  const merged = dedupePathSegments([...currentSegments, ...shellSegments, ...additionalSegments])

  return merged.join(delimiter)
}

export function computeHydratedLocaleEnv(
  input: ComputeHydratedLocaleEnvInput,
): Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>> {
  if (input.platform === 'win32') {
    return {}
  }

  if (isUtf8Locale(resolveEffectiveCharacterLocale(input.currentEnv))) {
    return {}
  }

  const loginShellLocale = resolveEffectiveCharacterLocale(input.loginShellEnv)
  const targetLocale = isUtf8Locale(loginShellLocale)
    ? loginShellLocale
    : resolveUtf8LocaleFallback(input.platform)

  const nextEnv: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>> = {
    LANG: isUtf8Locale(input.loginShellEnv.LANG) ? input.loginShellEnv.LANG : targetLocale,
    LC_CTYPE: isUtf8Locale(input.loginShellEnv.LC_CTYPE)
      ? input.loginShellEnv.LC_CTYPE
      : targetLocale,
  }

  if (input.currentEnv.LC_ALL?.trim()) {
    nextEnv.LC_ALL = isUtf8Locale(input.loginShellEnv.LC_ALL)
      ? input.loginShellEnv.LC_ALL
      : targetLocale
  }

  return nextEnv
}

export function hydrateCliEnvironmentForAppLaunch(isPackaged: boolean): void {
  if (!isPackaged) {
    return
  }

  const currentPath = process.env.PATH ?? ''
  const shellPath = resolvePosixShellPath(process.env.SHELL)

  const shellPathFromLogin =
    isPackaged && process.platform !== 'win32' ? readLoginShellPath(shellPath) : ''
  const loginShellLocaleEnv = process.platform !== 'win32' ? readLoginShellLocaleEnv(shellPath) : {}

  const applyHydratedLocaleEnv = (): void => {
    const nextLocaleEnv = computeHydratedLocaleEnv({
      platform: process.platform,
      currentEnv: process.env,
      loginShellEnv: loginShellLocaleEnv,
    })

    if (nextLocaleEnv.LANG) {
      process.env.LANG = nextLocaleEnv.LANG
    }
    if (nextLocaleEnv.LC_CTYPE) {
      process.env.LC_CTYPE = nextLocaleEnv.LC_CTYPE
    }
    if (nextLocaleEnv.LC_ALL) {
      process.env.LC_ALL = nextLocaleEnv.LC_ALL
    }
  }

  const nextPath = computeHydratedCliPath({
    isPackaged,
    platform: process.platform,
    currentPath,
    homeDir: resolveHomeDirectory(),
    shellPathFromLogin,
  })

  if (nextPath.trim().length === 0 || nextPath === currentPath) {
    applyHydratedLocaleEnv()
    return
  }

  process.env.PATH = nextPath
  applyHydratedLocaleEnv()
}
