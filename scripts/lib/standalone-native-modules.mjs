import { existsSync as defaultExistsSync, realpathSync as defaultRealpathSync } from 'node:fs'
import { resolve } from 'node:path'

export const STANDALONE_NATIVE_MODULE_NAMES = ['better-sqlite3', 'node-pty']

/**
 * Executables that some native modules produce on some platforms only. node-pty gates its
 * spawn-helper target behind `OS=="mac"` in binding.gyp, so a Linux or Windows bundle never
 * contains it. Anything listed here is chmod-ed only when it actually exists.
 */
const OPTIONAL_NATIVE_EXECUTABLES = [['node-pty', 'build', 'Release', 'spawn-helper']]

/**
 * Resolves where node-gyp should run for each native module, and where its build output goes.
 *
 * node-pty's binding.gyp shells out to `node -p "require('node-addon-api')..."`, which resolves
 * modules against `process.cwd()`. pnpm installs packages behind a link in `node_modules/<name>`
 * pointing into `node_modules/.pnpm/...`. POSIX canonicalizes cwd during chdir, so the package's
 * own dependencies stay reachable through the real directory; Windows junctions keep the link
 * path, and the lookup escapes to the (non-hoisted) root `node_modules` and fails. Running from
 * the realpath makes the behavior identical on every platform.
 */
export function resolveNativeModuleRebuildTargets({
  rootDir,
  appRoot,
  moduleNames = STANDALONE_NATIVE_MODULE_NAMES,
  realpathSync = defaultRealpathSync,
}) {
  return moduleNames.map(moduleName => {
    const linkedPath = resolve(rootDir, 'node_modules', moduleName)
    let modulePath = linkedPath
    try {
      modulePath = realpathSync(linkedPath)
    } catch {
      // A missing link is reported by node-gyp itself with a far clearer message.
    }

    return {
      moduleName,
      cwd: modulePath,
      sourceRelease: resolve(modulePath, 'build', 'Release'),
      destinationRelease: resolve(appRoot, 'node_modules', moduleName, 'build', 'Release'),
    }
  })
}

/**
 * Lists bundled native executables that need their executable bit restored, skipping any the
 * current platform never builds. Windows has no executable bit to restore.
 */
export function resolveOptionalNativeExecutables({
  appRoot,
  platform = process.platform,
  existsSync = defaultExistsSync,
}) {
  if (platform === 'win32') {
    return []
  }

  return OPTIONAL_NATIVE_EXECUTABLES.map(segments =>
    resolve(appRoot, 'node_modules', ...segments),
  ).filter(path => existsSync(path))
}
