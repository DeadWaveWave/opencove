import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGED_APP_ROOT_CANDIDATES = ['app.asar', 'app']

export function resolvePackagedAppRoot(resourcesPath: string): string {
  const matched = PACKAGED_APP_ROOT_CANDIDATES.map(candidate =>
    resolve(resourcesPath, candidate),
  ).find(candidate => existsSync(candidate))

  return matched ?? resolve(resourcesPath, PACKAGED_APP_ROOT_CANDIDATES[0])
}

export function resolvePackagedCliScriptPath(resourcesPath: string): string {
  return resolve(resolvePackagedAppRoot(resourcesPath), 'out', 'cli', 'opencove.mjs')
}

export function resolvePackagedWorkerScriptPath(resourcesPath: string): string {
  return resolve(resolvePackagedAppRoot(resourcesPath), 'out', 'main', 'worker.js')
}

/** TODO(build-artifact CLI PR): remove the source-entry fallback once all bundles ship out/cli. */
export function resolveWorkerCliScriptPath(workerDirectory: string): string {
  const built = resolve(workerDirectory, '..', 'cli', 'opencove.mjs')
  return existsSync(built)
    ? built
    : resolve(workerDirectory, '..', '..', 'src', 'app', 'cli', 'opencove.mjs')
}
