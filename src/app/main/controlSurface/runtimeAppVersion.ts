import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PACKAGE_JSON_SEARCH_DEPTH = 6

function readElectronAppVersion(): string | null {
  try {
    const electron = require('electron') as { app?: { getVersion?: () => string } } | string
    if (!electron || typeof electron === 'string') {
      return null
    }

    const version = electron.app?.getVersion?.()
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}

function readPackageVersionFrom(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}

export function readPackageVersionFromRuntimeDir(runtimeDir: string): string | null {
  let currentDir = runtimeDir

  for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth += 1) {
    const version = readPackageVersionFrom(resolve(currentDir, 'package.json'))
    if (version) {
      return version
    }

    const parentDir = resolve(currentDir, '..')
    if (parentDir === currentDir) {
      return null
    }
    currentDir = parentDir
  }

  return null
}

export function readRuntimeAppVersion(): string | null {
  return readElectronAppVersion() ?? readPackageVersionFromRuntimeDir(__dirname)
}
