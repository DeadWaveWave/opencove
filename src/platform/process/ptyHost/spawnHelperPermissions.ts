import { chmodSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

interface NodePtySpawnHelperPermissionDeps {
  requireResolve: (specifier: string) => string
  statSync: typeof statSync
  chmodSync: typeof chmodSync
  platform: NodeJS.Platform
  arch: string
}

const require = createRequire(import.meta.url)

function normalizeAsarPath(value: string): string {
  return value
    .replace('app.asar', 'app.asar.unpacked')
    .replace('node_modules.asar', 'node_modules.asar.unpacked')
}

function resolveNodePtyPackageRoot(requireResolve: (specifier: string) => string): string {
  const unixTerminalPath = requireResolve('node-pty/lib/unixTerminal.js')
  return normalizeAsarPath(resolve(dirname(unixTerminalPath), '..'))
}

export function resolveNodePtySpawnHelperPaths(
  deps: Pick<NodePtySpawnHelperPermissionDeps, 'requireResolve' | 'platform' | 'arch'> = {
    requireResolve: require.resolve.bind(require),
    platform: process.platform,
    arch: process.arch,
  },
): string[] {
  const packageRoot = resolveNodePtyPackageRoot(deps.requireResolve)
  const prebuildDir = `${deps.platform}-${deps.arch}`

  return [
    resolve(packageRoot, 'prebuilds', prebuildDir, 'spawn-helper'),
    resolve(packageRoot, 'build', 'Release', 'spawn-helper'),
    resolve(packageRoot, 'build', 'Debug', 'spawn-helper'),
  ]
}

export function ensureNodePtySpawnHelperExecutable(
  deps: NodePtySpawnHelperPermissionDeps = {
    requireResolve: require.resolve.bind(require),
    statSync,
    chmodSync,
    platform: process.platform,
    arch: process.arch,
  },
): boolean {
  let updated = false

  for (const helperPath of resolveNodePtySpawnHelperPaths(deps)) {
    try {
      const stats = deps.statSync(helperPath)
      if ((stats.mode & 0o111) !== 0) {
        continue
      }

      deps.chmodSync(helperPath, (stats.mode & 0o777) | 0o755)
      updated = true
    } catch {
      // Ignore missing helper candidates and permission repair failures.
    }
  }

  return updated
}
