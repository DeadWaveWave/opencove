import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGED_APP_ROOT_CANDIDATES = ['app.asar', 'app']

function resolveCliDirectory() {
  return resolve(fileURLToPath(new URL('.', import.meta.url)))
}

function resolveSourceRepoRoot() {
  return resolve(resolveCliDirectory(), '../../..')
}

function resolvePackagedResourcesPath() {
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath.trim() : ''
  return resourcesPath.length > 0 ? resourcesPath : null
}

function resolvePackagedAppRoot(resourcesPath) {
  const matched = PACKAGED_APP_ROOT_CANDIDATES.map(candidate =>
    resolve(resourcesPath, candidate),
  ).find(candidate => existsSync(candidate))

  return matched ?? resolve(resourcesPath, PACKAGED_APP_ROOT_CANDIDATES[0])
}

export function resolveCliRuntime() {
  const resourcesPath = resolvePackagedResourcesPath()
  if (!resourcesPath) {
    const repoRoot = resolveSourceRepoRoot()
    return {
      kind: 'source',
      repoRoot,
      workerScriptPath: resolve(repoRoot, 'out', 'main', 'worker.js'),
    }
  }

  const appRoot = resolvePackagedAppRoot(resourcesPath)
  return {
    kind: 'packaged',
    resourcesPath,
    appRoot,
    workerScriptPath: resolve(appRoot, 'out', 'main', 'worker.js'),
  }
}

export async function resolveElectronBinaryForWorkerStart(options = {}) {
  const processObject = options.processObject ?? process
  const importElectron = options.importElectron ?? (() => import('electron'))

  const execPath = typeof processObject?.execPath === 'string' ? processObject.execPath.trim() : ''
  const electronVersion =
    typeof processObject?.versions?.electron === 'string'
      ? processObject.versions.electron.trim()
      : ''

  if (execPath.length > 0 && electronVersion.length > 0) {
    return execPath
  }

  try {
    const electronImport = await importElectron()
    const candidate = electronImport?.default ?? electronImport?.['module.exports']
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null
  } catch {
    return null
  }
}
