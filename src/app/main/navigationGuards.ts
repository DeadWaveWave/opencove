import { isAbsolute, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const EXTERNAL_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim())
  } catch {
    return null
  }
}

export function shouldOpenUrlExternally(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl)
  if (!parsed) {
    return false
  }

  return EXTERNAL_PROTOCOL_ALLOWLIST.has(parsed.protocol)
}

export function resolveDevRendererOrigin(): string | null {
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (!raw) {
    return null
  }

  const parsed = parseUrl(raw)
  return parsed ? parsed.origin : null
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)

  if (relativePath === '') {
    return true
  }

  if (relativePath === '..') {
    return false
  }

  if (relativePath.startsWith(`..${sep}`)) {
    return false
  }

  if (isAbsolute(relativePath)) {
    return false
  }

  return true
}

function isAllowedFileNavigation(parsed: URL, rendererRootDir: string): boolean {
  let filePath: string

  try {
    filePath = fileURLToPath(parsed)
  } catch {
    return false
  }

  const normalizedRoot = resolve(rendererRootDir)
  const normalizedTarget = resolve(filePath)
  return isPathWithinRoot(normalizedRoot, normalizedTarget)
}

export function isAllowedNavigationTarget(
  rawUrl: string,
  devOrigin: string | null,
  rendererRootDir: string,
): boolean {
  const parsed = parseUrl(rawUrl)
  if (!parsed) {
    return false
  }

  if (devOrigin && parsed.origin === devOrigin) {
    return true
  }

  if (!devOrigin && parsed.protocol === 'file:') {
    return isAllowedFileNavigation(parsed, rendererRootDir)
  }

  return false
}
