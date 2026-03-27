function encodePathnameSegment(segment: string): string {
  // Preserve Windows drive letters (e.g. `C:`) while encoding other segments.
  if (/^[a-zA-Z]:$/.test(segment)) {
    return segment
  }

  return encodeURIComponent(segment)
}

function encodePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodePathnameSegment(segment)))
    .join('/')
}

function normalizeSlash(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Minimal `file:` URI builder that is safe to run in both renderer and main.
 *
 * It is intentionally lightweight (no Node.js builtins) so it can be used in web-bundled code.
 */
export function toFileUri(path: string): string {
  const normalized = normalizeSlash(path)

  // UNC path: `\\server\share\folder` (or already normalized `//server/share/folder`)
  if (normalized.startsWith('//')) {
    const parts = normalized.slice(2).split('/').filter(Boolean)
    const host = parts[0] ?? ''
    const rest = parts.slice(1).join('/')
    const pathname = rest.length > 0 ? `/${rest}` : '/'

    // `file://server/share/folder`
    return `file://${host}${encodePathname(pathname)}`
  }

  const driveMatch = normalized.match(/^([a-zA-Z]):(\/.*)?$/)
  if (driveMatch) {
    const driveLetter = driveMatch[1] ?? ''
    const restPath = driveMatch[2] ?? '/'
    const pathname = `/${driveLetter}:${restPath.startsWith('/') ? restPath : `/${restPath}`}`

    // `file:///C:/Users/...`
    return `file://${encodePathname(pathname)}`
  }

  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodePathname(pathname)}`
}
