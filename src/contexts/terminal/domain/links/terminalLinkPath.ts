import { toFileUri } from '../../../filesystem/domain/fileUri'
import type { TerminalLinkSourceContext, TerminalUnresolvedLinkTarget } from './terminalLinkTarget'

interface PreparedPath {
  status: 'prepared'
  path: string
  uri: string
  requiresConfirmation: boolean
}

const windowsAbsolute = /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i
const drivePrefix = /^[a-z]:/i
const schemePrefix = /^[a-z][a-z\d+.-]*:/i

export function hasTerminalLinkControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) {
      return true
    }
  }
  return false
}

function unresolved(reason: TerminalUnresolvedLinkTarget['reason']): TerminalUnresolvedLinkTarget {
  return { status: 'unresolved', reason }
}

function normalizeAbsolutePath(path: string, windows: boolean): string | null {
  const normalized = windows ? path.replace(/\\/g, '/') : path
  let root: string
  let remainder: string
  if (windows && /^[a-z]:\//i.test(normalized)) {
    root = normalized.slice(0, 3)
    remainder = normalized.slice(3)
  } else if (windows && normalized.startsWith('//')) {
    const match = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(normalized)
    if (!match) {
      return null
    }
    root = `//${match[1]}/${match[2]}/`
    remainder = normalized.slice(match[0].length)
  } else if (!windows && normalized.startsWith('/')) {
    root = '/'
    remainder = normalized.slice(1)
  } else {
    return null
  }
  const segments: string[] = []
  for (const segment of remainder.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return `${root}${segments.join('/')}`
}

function decodeFileUri(raw: string, windows: boolean): string | TerminalUnresolvedLinkTarget {
  if (!/^file:\//i.test(raw)) {
    return unresolved('invalid_target')
  }
  try {
    const uri = new URL(raw)
    if (uri.protocol !== 'file:' || uri.search || uri.hash || uri.username || uri.password) {
      return unresolved('invalid_target')
    }
    // Encoded separators must not change path identity when a URI becomes a native name.
    if (/%2f/i.test(uri.pathname) || (windows && /%5c/i.test(uri.pathname))) {
      return unresolved('invalid_target')
    }
    const path = decodeURIComponent(uri.pathname)
    if (uri.hostname && uri.hostname !== 'localhost') {
      if (!windows) {
        return unresolved('unsupported_authority')
      }
      return `//${uri.hostname}${path}`
    }
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  } catch {
    return unresolved('invalid_target')
  }
}

/** Resolve only within the source context. Filesystem verification belongs to the application. */
export function prepareTerminalLinkPath(
  rawTarget: string,
  source: TerminalLinkSourceContext,
): PreparedPath | TerminalUnresolvedLinkTarget {
  if (!rawTarget || hasTerminalLinkControlCharacters(rawTarget)) {
    return unresolved('invalid_target')
  }
  const windows = source.platform === 'windows'
  let path = rawTarget
  if (/^file:/i.test(path)) {
    const decoded = decodeFileUri(path, windows)
    if (typeof decoded !== 'string') {
      return decoded
    }
    path = decoded
  } else if (schemePrefix.test(path) && !drivePrefix.test(path)) {
    return unresolved('unsupported_scheme')
  }
  if (hasTerminalLinkControlCharacters(path)) {
    return unresolved('invalid_target')
  }
  if (!windows && (drivePrefix.test(path) || path.startsWith('\\\\'))) {
    return unresolved('platform_mismatch')
  }
  if (windows && drivePrefix.test(path) && !windowsAbsolute.test(path)) {
    return unresolved('invalid_target')
  }
  if (path.startsWith('~')) {
    if (!/^~(?:[\\/]|$)/.test(path) || !source.home) {
      return unresolved('unknown_home')
    }
    if (!normalizeAbsolutePath(source.home, windows)) {
      return unresolved('unknown_home')
    }
    path = `${source.home}/${path.slice(2)}`
  }
  let absolute = normalizeAbsolutePath(path, windows)
  let requiresConfirmation = false
  if (!absolute) {
    // A rooted path without a drive on Windows needs drive state that the context does not own.
    if (windows && /^[\\/]/.test(path)) {
      return unresolved('platform_mismatch')
    }
    if (source.cwdSource === 'unknown' || !source.cwd) {
      return unresolved('unknown_cwd')
    }
    absolute = normalizeAbsolutePath(`${source.cwd}/${path}`, windows)
    if (!absolute) {
      return unresolved('unknown_cwd')
    }
    requiresConfirmation = source.cwdSource === 'launch'
  }
  if (hasTerminalLinkControlCharacters(absolute)) {
    return unresolved('invalid_target')
  }
  try {
    const uri = windows
      ? toFileUri(absolute)
      : `file://${absolute.split('/').map(encodeURIComponent).join('/')}`
    return { status: 'prepared', path: absolute, uri, requiresConfirmation }
  } catch {
    return unresolved('invalid_target')
  }
}
