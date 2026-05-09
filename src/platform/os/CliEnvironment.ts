import process from 'node:process'
import { getCommandEnvironmentSnapshot } from './CommandEnvironmentService'
import { resolveHomeDirectory } from './HomeDirectory'

const POSIX_FALLBACK_PATH_SEGMENTS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

interface ComputeHydratedCliPathInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentPath: string
  homeDir: string
  shellPathFromLogin: string
  env?: NodeJS.ProcessEnv
}

interface ComputeHydratedLocaleEnvInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentEnv: NodeJS.ProcessEnv
  loginShellEnv: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>
}

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

function normalizePathSegment(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function appendPathSegment(segments: string[], value: string | null | undefined): void {
  const normalized = normalizePathSegment(value)
  if (normalized) {
    segments.push(normalized)
  }
}

function appendJoinedPathSegment(
  segments: string[],
  basePath: string | null | undefined,
  ...parts: string[]
): void {
  const normalizedBase = normalizePathSegment(basePath)
  if (normalizedBase) {
    segments.push([normalizedBase, ...parts].join('\\'))
  }
}

function appendJoinedPosixPathSegment(
  segments: string[],
  basePath: string | null | undefined,
  ...parts: string[]
): void {
  const normalizedBase = normalizePathSegment(basePath)
  if (normalizedBase) {
    segments.push([normalizedBase, ...parts].join('/'))
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

export function buildAdditionalPathSegments(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const segments: string[] = []
    appendPathSegment(segments, env.NVM_SYMLINK)
    appendPathSegment(segments, env.PNPM_HOME)
    appendJoinedPathSegment(segments, env.APPDATA, 'npm')
    appendJoinedPathSegment(segments, env.LOCALAPPDATA, 'pnpm')
    appendJoinedPathSegment(segments, env.LOCALAPPDATA, 'Volta', 'bin')
    appendJoinedPathSegment(segments, homeDir, 'AppData', 'Roaming', 'npm')
    appendJoinedPathSegment(segments, homeDir, 'AppData', 'Local', 'pnpm')
    appendJoinedPathSegment(segments, homeDir, 'AppData', 'Local', 'Volta', 'bin')
    appendJoinedPathSegment(segments, homeDir, 'scoop', 'shims')
    appendJoinedPathSegment(segments, env.SCOOP, 'shims')
    appendJoinedPathSegment(segments, env.ProgramData, 'scoop', 'shims')
    appendJoinedPathSegment(segments, env.ChocolateyInstall, 'bin')
    appendJoinedPathSegment(segments, env.ProgramFiles, 'nodejs')
    appendJoinedPathSegment(segments, env.ProgramFiles, 'nodejs', 'node_global')
    appendJoinedPathSegment(segments, env['ProgramFiles(x86)'], 'nodejs')
    return dedupePathSegments(segments)
  }

  const segments: string[] = []
  appendPathSegment(segments, env.PNPM_HOME)
  if (homeDir.trim().length > 0) {
    segments.push(`${homeDir}/.local/bin`)
    segments.push(`${homeDir}/bin`)
    segments.push(`${homeDir}/.npm-global/bin`)
    segments.push(`${homeDir}/.local/share/mise/shims`)
  }
  appendJoinedPosixPathSegment(
    segments,
    env.VOLTA_HOME ?? (homeDir.trim() ? `${homeDir}/.volta` : null),
    'bin',
  )
  appendJoinedPosixPathSegment(
    segments,
    env.ASDF_DATA_DIR ?? (homeDir.trim() ? `${homeDir}/.asdf` : null),
    'shims',
  )
  appendJoinedPosixPathSegment(
    segments,
    env.XDG_DATA_HOME ?? (homeDir.trim() ? `${homeDir}/.local/share` : null),
    'mise',
    'shims',
  )

  segments.push(...POSIX_FALLBACK_PATH_SEGMENTS)
  return dedupePathSegments(segments)
}

export function computeHydratedCliPath(input: ComputeHydratedCliPathInput): string {
  const delimiter = input.platform === 'win32' ? ';' : ':'

  if (!input.isPackaged) {
    return input.currentPath
  }

  const currentSegments = splitPath(input.currentPath, delimiter)
  const shellSegments = splitPath(input.shellPathFromLogin, delimiter)
  const additionalSegments = buildAdditionalPathSegments(input.platform, input.homeDir, input.env)
  const merged = dedupePathSegments([...currentSegments, ...shellSegments, ...additionalSegments])

  return merged.join(delimiter)
}

export function computeHydratedLocaleEnv(
  input: ComputeHydratedLocaleEnvInput,
): Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>> {
  if (!input.isPackaged) {
    return {}
  }

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

export async function hydrateCliEnvironmentForAppLaunch(isPackaged: boolean): Promise<void> {
  if (!isPackaged) {
    return
  }

  const currentPath = process.env.PATH ?? ''
  const commandEnvironment = await getCommandEnvironmentSnapshot()
  const shellPathFromLogin = process.platform !== 'win32' ? (commandEnvironment.env.PATH ?? '') : ''
  const loginShellLocaleEnv =
    process.platform !== 'win32'
      ? {
          LANG: commandEnvironment.env.LANG,
          LC_ALL: commandEnvironment.env.LC_ALL,
          LC_CTYPE: commandEnvironment.env.LC_CTYPE,
        }
      : {}

  const applyHydratedLocaleEnv = (): void => {
    const nextLocaleEnv = computeHydratedLocaleEnv({
      isPackaged,
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
