import { dirname, resolve } from 'node:path'

import { STANDALONE_NATIVE_MODULE_NAMES } from './standalone-native-modules.mjs'

/**
 * The versioned-symbol floor for everything we ship in the standalone server bundle.
 *
 * `GLIBC_2.28` is not a preference, it is what the official Node linux-x64 binary we bundle
 * already requires, so it is the bundle's natural floor: building the native modules any lower
 * buys nothing, and building them higher makes them the single short plank (which is exactly how
 * nightly run 32229590172 failed inside debian:bookworm-slim).
 *
 * `GLIBCXX_3.4.25` matches the documented VS Code Linux server requirement. The bundled Node only
 * needs 3.4.21, but a gcc-toolset build links the newer C++ runtime bits statically and still
 * leaves a 3.4.25-era dynamic dependency, so 3.4.25 is the honest number to promise.
 *
 * Coverage at this floor: RHEL/Alma/Rocky 8+, Debian 10+, Ubuntu 18.04+, Amazon Linux 2023.
 */
/**
 * The binary each native module actually produces. The file name does not always match the
 * package name (node-pty ships `pty.node`).
 */
const NATIVE_MODULE_BINARY_NAMES = {
  'better-sqlite3': 'better_sqlite3.node',
  'node-pty': 'pty.node',
}

export const STANDALONE_GLIBC_FLOOR = Object.freeze({ GLIBC: '2.28', GLIBCXX: '3.4.25' })

const VERSION_NEED_PATTERN = /Name:\s+(GLIBC|GLIBCXX)_([0-9][0-9.]*)/g

/**
 * Extracts the versioned symbol requirements from `readelf --version-info` output.
 *
 * Only `.gnu.version_r` "Name:" entries are read. The NEEDED lines are deliberately ignored: a
 * plain `libm.so.6` dependency is fine, what matters is which *version* of a symbol is demanded.
 *
 * @param {string} readelfOutput
 * @param {{ requireSymbols?: boolean }} [options] When `requireSymbols` is set, output that yields
 *   nothing throws instead of returning an empty list. An empty result is ambiguous — it can mean
 *   "clean artifact" or "we failed to read the artifact" — and silently accepting the latter would
 *   let an unverified binary ship.
 * @returns {{ library: string, version: string }[]}
 */
export function parseVersionedSymbolRequirements(readelfOutput, options = {}) {
  const requirements = []
  for (const match of String(readelfOutput ?? '').matchAll(VERSION_NEED_PATTERN)) {
    requirements.push({ library: match[1], version: match[2] })
  }

  if (options.requireSymbols && requirements.length === 0) {
    throw new Error(
      'Found no versioned symbol requirements to check. Refusing to report an unread artifact as clean.',
    )
  }

  return requirements
}

/**
 * Compares dotted numeric versions componentwise. String comparison would rank `2.9` above `2.28`
 * and `3.4.9` above `3.4.25`, silently inverting the check.
 */
function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/**
 * Returns the requirements that exceed the floor. An unknown library prefix is reported rather
 * than ignored, so a new versioned dependency cannot slip in unnoticed.
 *
 * @param {{ library: string, version: string }[]} requirements
 * @param {Record<string, string>} [floor]
 * @returns {{ library: string, version: string }[]}
 */
export function selectFloorViolations(requirements, floor = STANDALONE_GLIBC_FLOOR) {
  return requirements.filter(({ library, version }) => {
    const allowed = floor[library]
    if (allowed === undefined) {
      return true
    }

    return compareVersions(version, allowed) > 0
  })
}

/**
 * Builds an actionable failure message: which artifact, which symbol, and what was allowed.
 *
 * @param {string} artifact
 * @param {{ library: string, version: string }[]} violations
 * @param {Record<string, string>} [floor]
 */
export function formatFloorViolations(artifact, violations, floor = STANDALONE_GLIBC_FLOOR) {
  const details = violations
    .map(({ library, version }) => {
      const allowed = floor[library] ?? 'not allowed at all'
      return `  requires ${library}_${version} (floor: ${library}_${allowed})`
    })
    .join('\n')

  return [
    `${artifact} exceeds the supported symbol floor:`,
    details,
    'Rebuild the native modules in the old-glibc container (see docs/runtime/RELEASING.md).',
  ].join('\n')
}

/**
 * Resolves how to invoke node-gyp for one native module.
 *
 * Without `containerImage` this runs node-gyp directly, which is what macOS and Windows do. With
 * one, node-gyp runs inside an old-glibc image so the produced `.node` files stay within the
 * floor above.
 *
 * The repository is mounted at its own path so that the module realpath computed on the host is
 * still valid inside the container — that realpath is what keeps #357's Windows `node-addon-api`
 * resolution fix working, and rewriting it here would quietly undo it.
 *
 * @param {{
 *   nodeExecutable: string,
 *   nodeGypScript: string,
 *   moduleCwd: string,
 *   rootDir: string,
 *   containerImage?: string,
 *   hostUser?: string,
 * }} options
 */
export function resolveNativeModuleRebuildCommand({
  nodeExecutable,
  nodeGypScript,
  moduleCwd,
  rootDir,
  containerImage,
  hostUser,
}) {
  const nodeGypArgs = [nodeGypScript, 'rebuild', '--release']

  if (!containerImage) {
    return { command: nodeExecutable, args: nodeGypArgs, cwd: moduleCwd }
  }

  const args = ['run', '--rm', '--volume', `${rootDir}:${rootDir}`, '--workdir', moduleCwd]
  const nodeBinDirectory = dirname(nodeExecutable)

  // The bundled Node usually lives outside the repo mount (it is unpacked into dist/, but the
  // caller may point elsewhere), so make sure its directory is reachable inside the container.
  if (!nodeBinDirectory.startsWith(`${rootDir}/`)) {
    args.push('--volume', `${nodeBinDirectory}:${nodeBinDirectory}`)
  }

  if (hostUser) {
    // Without this the container writes root-owned build output into the mounted workspace and
    // every later step on the runner fails with EACCES.
    args.push('--user', hostUser)
  }

  // A non-root container user has no writable home, and node-gyp needs both a cache and a devdir
  // for the downloaded headers. Keep them inside the mount, which is writable by that user.
  args.push('--env', `HOME=${rootDir}/.cache/standalone-native-build`)
  args.push('--env', `npm_config_devdir=${rootDir}/.cache/standalone-native-build/node-gyp`)
  args.push('--env', 'npm_config_runtime=node')

  // Some binding.gyp actions shell out to a bare `node` — better-sqlite3's
  // `copy_builtin_sqlite3` action is literally `['node', 'copy.js', ...]` — which is not on PATH
  // in a build image, and make reports only an opaque `Error 127`.
  //
  // PATH must be *prepended*, not replaced: an old-glibc image keeps its modern compiler on a
  // toolset path (gcc-toolset on manylinux), so overwriting PATH loses the C++20 compiler and
  // fails the same opaque way one stage later. Paths are passed as argv rather than interpolated
  // into the script so a path containing a space or a quote cannot break the command.
  args.push(
    containerImage,
    'sh',
    '-c',
    'PATH="$1:$PATH"; export PATH; shift; exec "$@"',
    'opencove-native-build',
    nodeBinDirectory,
    nodeExecutable,
    ...nodeGypArgs,
  )

  return { command: 'docker', args, cwd: rootDir }
}

/**
 * Lists the artifacts whose symbol floor actually matters for a Linux bundle: the native modules
 * we rebuild ourselves, plus the Node binary that has to load them.
 *
 * Deliberately NOT "every .node under the bundle". A bundle also carries prebuilds for other
 * platforms (`prebuilds/darwin-*`, `prebuilds/win32-*`) and musl variants of build-time tooling.
 * Those are Mach-O, PE, or musl-linked, so a glibc floor is a category error for them and reading
 * them yields "not an ELF file". Checking them would force the gate to tolerate unreadable files,
 * which would in turn let a genuinely unreadable glibc artifact slip through as "clean".
 *
 * @param {{ appRoot: string, bundledNodeExecutable: string, moduleNames?: string[] }} options
 * @returns {string[]} Absolute paths, in a stable order.
 */
export function resolveGlibcFloorArtifacts({
  appRoot,
  bundledNodeExecutable,
  moduleNames = STANDALONE_NATIVE_MODULE_NAMES,
}) {
  const artifacts = [bundledNodeExecutable]

  for (const moduleName of moduleNames) {
    const releaseDir = resolve(appRoot, 'node_modules', moduleName, 'build', 'Release')
    artifacts.push(
      resolve(releaseDir, NATIVE_MODULE_BINARY_NAMES[moduleName] ?? `${moduleName}.node`),
    )
  }

  return artifacts
}
