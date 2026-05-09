import process from 'node:process'

const POSIX_FALLBACK_PATH_SEGMENTS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export function splitPathSegments(pathValue: string, delimiter: string): string[] {
  if (pathValue.trim().length === 0) {
    return []
  }

  return pathValue
    .split(delimiter)
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

export function dedupePathSegments(segments: readonly string[]): string[] {
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

export function mergeCommandPath(input: {
  platform: NodeJS.Platform
  currentPath: string
  discoveredPath?: string
  homeDir: string
  env?: NodeJS.ProcessEnv
}): string {
  const delimiter = input.platform === 'win32' ? ';' : ':'
  const currentSegments = splitPathSegments(input.currentPath, delimiter)
  const discoveredSegments = splitPathSegments(input.discoveredPath ?? '', delimiter)
  const additionalSegments = buildAdditionalPathSegments(input.platform, input.homeDir, input.env)

  return dedupePathSegments([
    ...currentSegments,
    ...discoveredSegments,
    ...additionalSegments,
  ]).join(delimiter)
}
