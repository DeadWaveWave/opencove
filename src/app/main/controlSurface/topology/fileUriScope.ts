import { posix as pathPosix } from 'node:path'
import { createAppError } from '../../../../shared/errors/appError'

function normalizeFileHost(host: string): string {
  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' ? '' : normalized
}

function normalizeMacPrivateAlias(pathname: string): string {
  if (pathname === '/private/var' || pathname.startsWith('/private/var/')) {
    return pathname.slice('/private'.length)
  }

  if (pathname === '/private/tmp' || pathname.startsWith('/private/tmp/')) {
    return pathname.slice('/private'.length)
  }

  return pathname
}

function normalizeFileUriPathname(uri: string): { host: string; pathname: string } {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid file uri.' })
  }

  const host = normalizeFileHost(parsed.host ?? '')
  let pathname = parsed.pathname ?? '/'

  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // ignore malformed URI escapes; rely on raw pathname
  }

  pathname = pathPosix.normalize(pathname)
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  pathname = normalizeMacPrivateAlias(pathname)

  return { host, pathname }
}

export function assertFileUriWithinRootUri(options: {
  rootUri: string
  uri: string
  debugMessage: string
}): void {
  const root = normalizeFileUriPathname(options.rootUri)
  const target = normalizeFileUriPathname(options.uri)

  if (root.host !== target.host) {
    throw createAppError('common.invalid_input', { debugMessage: options.debugMessage })
  }

  if (root.pathname === '/') {
    return
  }

  if (target.pathname === root.pathname) {
    return
  }

  if (target.pathname.startsWith(root.pathname) && target.pathname[root.pathname.length] === '/') {
    return
  }

  throw createAppError('common.invalid_input', { debugMessage: options.debugMessage })
}
