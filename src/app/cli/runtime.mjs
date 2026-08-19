import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGED_APP_ROOT_CANDIDATES = ['app.asar', 'app']

function resolveCliDirectory() {
  return resolve(fileURLToPath(new URL('.', import.meta.url)))
}

function resolveSourceRepoRoot(cliDirectory) {
  return resolve(cliDirectory, '../../..')
}

function resolvePackagedResourcesPath(processObject) {
  const resourcesPath =
    typeof processObject?.resourcesPath === 'string' ? processObject.resourcesPath.trim() : ''
  return resourcesPath.length > 0 ? resourcesPath : null
}

function resolvePackagedAppRoot(resourcesPath) {
  const matched = PACKAGED_APP_ROOT_CANDIDATES.map(candidate =>
    resolve(resourcesPath, candidate),
  ).find(candidate => existsSync(candidate))

  return matched ?? resolve(resourcesPath, PACKAGED_APP_ROOT_CANDIDATES[0])
}

function readManifestValue(content, key) {
  const prefix = `${key}=`
  const matched = content.split(/\r?\n/u).find(line => line.startsWith(prefix))
  return matched?.slice(prefix.length).trim() ?? ''
}

export function resolveCliRuntime(options = {}) {
  const cliDirectory = options.cliDirectory ?? resolveCliDirectory()
  const existsSyncImpl = options.existsSyncImpl ?? existsSync
  const readFileSyncImpl = options.readFileSyncImpl ?? readFileSync
  const resourcesPath =
    options.resourcesPath === undefined
      ? resolvePackagedResourcesPath(options.processObject ?? process)
      : options.resourcesPath

  if (!resourcesPath) {
    const repoRoot = resolveSourceRepoRoot(cliDirectory)
    const manifestPath = resolve(repoRoot, '..', 'opencove-runtime.env')
    if (existsSyncImpl(manifestPath)) {
      const manifest = readFileSyncImpl(manifestPath, 'utf8')
      const nodeRelativePath = readManifestValue(manifest, 'OPENCOVE_NODE_RELATIVE_PATH')
      return {
        kind: 'standalone',
        appRoot: repoRoot,
        nodeExecutablePath:
          nodeRelativePath.length > 0 ? resolve(repoRoot, '..', nodeRelativePath) : null,
        workerScriptPath: resolve(repoRoot, 'out', 'main', 'worker.js'),
      }
    }

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

export async function resolveWorkerRuntimeForStart(options = {}) {
  const cliRuntime = options.cliRuntime ?? resolveCliRuntime()
  const processObject = options.processObject ?? process

  if (cliRuntime.kind === 'standalone') {
    const execPath =
      typeof processObject?.execPath === 'string' ? processObject.execPath.trim() : ''
    const nodeVersion =
      typeof processObject?.versions?.node === 'string' ? processObject.versions.node.trim() : ''
    const electronVersion =
      typeof processObject?.versions?.electron === 'string'
        ? processObject.versions.electron.trim()
        : ''

    const expectedNodePath =
      typeof cliRuntime.nodeExecutablePath === 'string' ? cliRuntime.nodeExecutablePath.trim() : ''
    let isBundledNode = false
    if (execPath.length > 0 && expectedNodePath.length > 0) {
      try {
        const realpathSyncImpl = options.realpathSyncImpl ?? realpathSync
        isBundledNode = realpathSyncImpl(execPath) === realpathSyncImpl(expectedNodePath)
      } catch {
        isBundledNode = false
      }
    }

    if (!isBundledNode || nodeVersion.length === 0 || electronVersion.length > 0) {
      throw new Error(
        `standalone worker requires the bundled Node runtime at ${expectedNodePath || '<missing manifest path>'}; refusing to fall back to another runtime`,
      )
    }

    return { kind: 'node', executablePath: execPath }
  }

  const electronBinary = await resolveElectronBinaryForWorkerStart(options)
  if (!electronBinary) {
    throw new Error(
      'unable to resolve Electron runtime for starting the worker; ensure dependencies are installed',
    )
  }

  return { kind: 'electron', executablePath: electronBinary }
}

export function createWorkerSpawnEnvironment(runtimeKind, sourceEnv = process.env, options = {}) {
  const env = {
    ...sourceEnv,
    OPENCOVE_TRUST_PROCESS_ENV: '1',
  }

  if (runtimeKind === 'node') {
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_DISABLE_SANDBOX
    return env
  }

  env.ELECTRON_RUN_AS_NODE = '1'
  if (options.disableElectronSandbox) {
    env.ELECTRON_DISABLE_SANDBOX = '1'
  }
  return env
}
