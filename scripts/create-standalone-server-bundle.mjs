#!/usr/bin/env node

import { chmod, copyFile, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createTarArchive } from './lib/standalone-bundle-archive.mjs'
import {
  STANDALONE_NATIVE_MODULE_NAMES,
  resolveNativeModuleRebuildTargets,
  resolveOptionalNativeExecutables,
} from './lib/standalone-native-modules.mjs'

const rootDir = resolve(import.meta.dirname, '..')
const distDir = resolve(rootDir, 'dist')

function toReleasePlatform(platform) {
  if (platform === 'darwin') {
    return 'macos'
  }

  if (platform === 'linux') {
    return 'linux'
  }

  if (platform === 'win32') {
    return 'windows'
  }

  throw new Error(`Standalone server bundles are not supported on ${platform}.`)
}

function toReleaseArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch
  }

  throw new Error(`Unsupported standalone server architecture: ${arch}`)
}

async function collectDirectories(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => resolve(dirPath, entry.name))
}

async function pathExists(pathname) {
  try {
    await stat(pathname)
    return true
  } catch {
    return false
  }
}

async function resolveRuntimeSource(options) {
  const directories = await collectDirectories(distDir)

  if (options.platform === 'darwin') {
    const nestedGroups = await Promise.all(
      directories.map(
        async directoryPath => await collectDirectories(directoryPath).catch(() => []),
      ),
    )
    const appCandidates = nestedGroups.flat().filter(candidate => candidate.endsWith('.app'))
    const resolvedCandidates = await Promise.all(
      appCandidates.map(async candidate => {
        const resourcesDir = resolve(candidate, 'Contents', 'Resources')
        const appAsarPath = resolve(resourcesDir, 'app.asar')
        return (await pathExists(appAsarPath)) ? { appAsarPath } : null
      }),
    )
    const matched = resolvedCandidates.find(Boolean)
    if (matched) {
      return matched
    }

    throw new Error('Unable to locate macOS unpacked app for standalone bundle.')
  }

  if (options.platform === 'linux') {
    const resolvedCandidates = await Promise.all(
      directories.map(async directoryPath => {
        const appAsarPath = resolve(directoryPath, 'resources', 'app.asar')
        return (await pathExists(appAsarPath)) ? { appAsarPath } : null
      }),
    )
    const matched = resolvedCandidates.find(Boolean)
    if (matched) {
      return matched
    }

    throw new Error('Unable to locate Linux unpacked app for standalone bundle.')
  }

  if (options.platform === 'win32') {
    const resolvedCandidates = await Promise.all(
      directories.map(async directoryPath => {
        const appAsarPath = resolve(directoryPath, 'resources', 'app.asar')
        return (await pathExists(appAsarPath)) ? { appAsarPath } : null
      }),
    )
    const matched = resolvedCandidates.find(Boolean)
    if (matched) {
      return matched
    }

    throw new Error('Unable to locate Windows unpacked app for standalone bundle.')
  }

  throw new Error(`Unsupported standalone platform: ${options.platform}`)
}

function resolveRelativePaths(platform) {
  return {
    nodeRelativePath: platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node',
    cliScriptRelativePath: 'app/src/app/cli/opencove.mjs',
  }
}

function loadAsar() {
  const require = createRequire(import.meta.url)
  const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
  return electronBuilderRequire('@electron/asar')
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `${command} failed`
    throw new Error(detail)
  }
  return result.stdout?.trim() ?? ''
}

function inspectNodeRuntime(nodeExecutable) {
  const output = runChecked(nodeExecutable, [
    '-p',
    'JSON.stringify({node:process.versions.node,modules:process.versions.modules,electron:process.versions.electron||null})',
  ])
  const runtime = JSON.parse(output)
  if (!runtime.node || !runtime.modules || runtime.electron) {
    throw new Error(`Standalone bundles require a pure Node executable: ${nodeExecutable}`)
  }
  return runtime
}

async function copyNodeRuntime(nodeExecutable, runtimeRoot, platform) {
  const destination = resolve(
    runtimeRoot,
    'node',
    ...(platform === 'win32' ? ['node.exe'] : ['bin', 'node']),
  )
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(nodeExecutable, destination)
  if (platform !== 'win32') {
    await chmod(destination, 0o755)
  }

  const licenseCandidates =
    platform === 'win32'
      ? [resolve(dirname(nodeExecutable), 'LICENSE')]
      : [
          resolve(dirname(nodeExecutable), '..', 'LICENSE'),
          resolve(dirname(nodeExecutable), '..', 'share', 'doc', 'node', 'LICENSE'),
        ]
  const licensePath = (
    await Promise.all(
      licenseCandidates.map(async candidate => ((await pathExists(candidate)) ? candidate : null)),
    )
  ).find(Boolean)
  if (!licensePath) {
    throw new Error(`Unable to locate the bundled Node runtime license for ${nodeExecutable}.`)
  }
  await copyFile(licensePath, resolve(runtimeRoot, 'node', 'LICENSE'))
}

async function rebuildAndVerifyNativeModules({
  appRoot,
  nodeExecutable,
  bundledNodeExecutable,
  runtime,
}) {
  const require = createRequire(import.meta.url)
  const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
  const nodeGypScript = electronBuilderRequire.resolve('node-gyp/bin/node-gyp.js')
  const env = {
    ...process.env,
    npm_config_runtime: 'node',
    npm_config_target: runtime.node,
  }
  const rebuildTargets = resolveNativeModuleRebuildTargets({
    rootDir,
    appRoot,
    moduleNames: STANDALONE_NATIVE_MODULE_NAMES,
  })

  try {
    for (const { cwd: moduleCwd } of rebuildTargets) {
      runChecked(nodeExecutable, [nodeGypScript, 'rebuild', '--release'], {
        cwd: moduleCwd,
        env,
        stdio: 'inherit',
      })
    }
    await Promise.all(
      rebuildTargets.map(async ({ sourceRelease, destinationRelease }) => {
        await rm(destinationRelease, { recursive: true, force: true })
        await cp(sourceRelease, destinationRelease, { recursive: true })
      }),
    )

    await Promise.all(resolveOptionalNativeExecutables({ appRoot }).map(path => chmod(path, 0o755)))
  } finally {
    const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    runChecked(pnpmCommand, ['exec', 'electron-builder', 'install-app-deps'], {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })
  }

  const verifyScript = [
    "const {createRequire}=require('node:module')",
    "const requireFromApp=createRequire(require('node:path').resolve(process.cwd(),'package.json'))",
    "const Database=requireFromApp('better-sqlite3')",
    "const database=new Database(':memory:')",
    'database.close()',
    "const pty=requireFromApp('node-pty')",
    "if(typeof pty.spawn!=='function')throw new Error('node-pty did not expose spawn')",
    "if(process.versions.electron)throw new Error('bundled runtime is Electron, not pure Node')",
    "process.stdout.write('native modules loaded with Node ABI '+process.versions.modules+'\\n')",
  ].join(';')
  // Verify with the Node that actually ships in the bundle. Verifying with the build host's
  // Node would pass even when the copied runtime is unusable (for example a dynamically linked
  // Homebrew build whose libnode is left behind), which is exactly what users would hit first.
  runChecked(bundledNodeExecutable, ['-e', verifyScript], { cwd: appRoot, env, stdio: 'inherit' })
}

function quotePowerShellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`
}

function runZip(outputPath, sourceDirName) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `Compress-Archive -LiteralPath ${quotePowerShellLiteral(resolve(distDir, sourceDirName))} -DestinationPath ${quotePowerShellLiteral(outputPath)} -Force`,
  ].join('; ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      cwd: distDir,
      encoding: 'utf8',
    },
  )

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'Compress-Archive failed'
    throw new Error(detail)
  }
}

const platform = toReleasePlatform(process.platform)
const arch = toReleaseArch(process.arch)
const bundleName = `opencove-server-${platform}-${arch}`
const bundleRoot = resolve(distDir, bundleName)
const runtimeRoot = resolve(bundleRoot, 'runtime')
const appRoot = resolve(bundleRoot, 'app')
const archiveExtension = process.platform === 'win32' ? 'zip' : 'tar.gz'
const archivePath = resolve(distDir, `${bundleName}.${archiveExtension}`)
const runtimeSource = await resolveRuntimeSource({
  platform: process.platform,
})
const relativePaths = resolveRelativePaths(process.platform)
const nodeExecutable = resolve(process.env.OPENCOVE_NODE_EXECUTABLE ?? process.execPath)
const nodeRuntime = inspectNodeRuntime(nodeExecutable)

await rm(bundleRoot, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(runtimeRoot, { recursive: true })
await copyNodeRuntime(nodeExecutable, runtimeRoot, process.platform)
loadAsar().extractAll(runtimeSource.appAsarPath, appRoot)
await rebuildAndVerifyNativeModules({
  appRoot,
  nodeExecutable,
  bundledNodeExecutable: resolve(bundleRoot, relativePaths.nodeRelativePath),
  runtime: nodeRuntime,
})
await writeFile(
  resolve(bundleRoot, 'opencove-runtime.env'),
  [
    `OPENCOVE_NODE_RELATIVE_PATH=${relativePaths.nodeRelativePath}`,
    `OPENCOVE_CLI_SCRIPT_RELATIVE_PATH=${relativePaths.cliScriptRelativePath}`,
    `OPENCOVE_NODE_VERSION=${nodeRuntime.node}`,
    `OPENCOVE_NODE_MODULE_VERSION=${nodeRuntime.modules}`,
    '',
  ].join('\n'),
  'utf8',
)
await writeFile(
  resolve(bundleRoot, 'README.txt'),
  [
    'OpenCove standalone server runtime bundle',
    '',
    `Bundled Node.js ${nodeRuntime.node} (module ABI ${nodeRuntime.modules}).`,
    'Use the release installer script or point a launcher at runtime/node.',
    '',
  ].join('\n'),
  'utf8',
)
if (process.platform === 'win32') {
  runZip(archivePath, bundleName)
} else {
  createTarArchive({ cwd: distDir, outputPath: archivePath, sourceDirName: bundleName })
}
process.stdout.write(`Created standalone server bundle: ${archivePath}\n`)
