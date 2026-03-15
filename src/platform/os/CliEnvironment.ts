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

interface ComputeHydratedCliPathInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentPath: string
  homeDir: string
  shellPathFromLogin: string
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

export function hydrateCliPathForPackagedApp(isPackaged: boolean): void {
  const currentPath = process.env.PATH ?? ''

  const shellPathFromLogin =
    isPackaged && process.platform !== 'win32'
      ? readLoginShellPath(resolvePosixShellPath(process.env.SHELL))
      : ''

  const nextPath = computeHydratedCliPath({
    isPackaged,
    platform: process.platform,
    currentPath,
    homeDir: resolveHomeDirectory(),
    shellPathFromLogin,
  })

  if (nextPath.trim().length === 0 || nextPath === currentPath) {
    return
  }

  process.env.PATH = nextPath
}
