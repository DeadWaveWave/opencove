#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const rootDir = resolve(import.meta.dirname, '..')
const distDir = resolve(rootDir, 'dist')
const packageJsonPath = resolve(rootDir, 'package.json')

function toReleasePlatform(platform) {
  if (platform === 'darwin') {
    return 'macos'
  }

  if (platform === 'linux') {
    return 'linux'
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

async function resolvePackagedAppRootName(resourcesDir) {
  const [hasAppAsar, hasAppDir] = await Promise.all([
    pathExists(resolve(resourcesDir, 'app.asar')),
    pathExists(resolve(resourcesDir, 'app')),
  ])

  if (hasAppAsar) {
    return 'app.asar'
  }

  if (hasAppDir) {
    return 'app'
  }

  return null
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
        const appRootName = await resolvePackagedAppRootName(resourcesDir)
        return appRootName ? { kind: 'macos-app', runtimePath: candidate, appRootName } : null
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
        const executablePath = resolve(directoryPath, options.executableName)
        const resourcesDir = resolve(directoryPath, 'resources')
        const [hasExecutable, appRootName] = await Promise.all([
          pathExists(executablePath),
          resolvePackagedAppRootName(resourcesDir),
        ])

        return hasExecutable && appRootName
          ? { kind: 'linux-unpacked', runtimePath: directoryPath, appRootName }
          : null
      }),
    )
    const matched = resolvedCandidates.find(Boolean)
    if (matched) {
      return matched
    }

    throw new Error('Unable to locate Linux unpacked app for standalone bundle.')
  }

  throw new Error(`Unsupported standalone platform: ${options.platform}`)
}

function resolveRelativePaths(input) {
  const runtimeDirName = basename(input.runtimePath)
  const appRootName = input.appRootName

  if (input.platform === 'darwin') {
    return {
      executableRelativePath: `runtime/${runtimeDirName}/Contents/MacOS/${input.executableName}`,
      cliScriptRelativePath: `runtime/${runtimeDirName}/Contents/Resources/${appRootName}/src/app/cli/opencove.mjs`,
    }
  }

  return {
    executableRelativePath: `runtime/${runtimeDirName}/${input.executableName}`,
    cliScriptRelativePath: `runtime/${runtimeDirName}/resources/${appRootName}/src/app/cli/opencove.mjs`,
  }
}

function runTar(outputPath, sourceDirName) {
  const result = spawnSync('tar', ['-czf', outputPath, sourceDirName], {
    cwd: distDir,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'tar failed'
    throw new Error(detail)
  }
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const executableName = packageJson?.build?.executableName

if (typeof executableName !== 'string' || executableName.trim().length === 0) {
  throw new Error('package.json build.executableName is missing.')
}

const platform = toReleasePlatform(process.platform)
const arch = toReleaseArch(process.arch)
const bundleName = `opencove-server-${platform}-${arch}`
const bundleRoot = resolve(distDir, bundleName)
const runtimeRoot = resolve(bundleRoot, 'runtime')
const tarballPath = resolve(distDir, `${bundleName}.tar.gz`)
const runtimeSource = await resolveRuntimeSource({
  platform: process.platform,
  executableName,
})
const relativePaths = resolveRelativePaths({
  platform: process.platform,
  runtimePath: runtimeSource.runtimePath,
  appRootName: runtimeSource.appRootName,
  executableName,
})

await rm(bundleRoot, { recursive: true, force: true })
await rm(tarballPath, { force: true })
await mkdir(runtimeRoot, { recursive: true })
await cp(runtimeSource.runtimePath, resolve(runtimeRoot, basename(runtimeSource.runtimePath)), {
  recursive: true,
})
await writeFile(
  resolve(bundleRoot, 'opencove-runtime.env'),
  [
    `OPENCOVE_EXECUTABLE_RELATIVE_PATH=${relativePaths.executableRelativePath}`,
    `OPENCOVE_CLI_SCRIPT_RELATIVE_PATH=${relativePaths.cliScriptRelativePath}`,
    '',
  ].join('\n'),
  'utf8',
)
await writeFile(
  resolve(bundleRoot, 'README.txt'),
  [
    'OpenCove standalone server runtime bundle',
    '',
    'Use the release installer script or point a launcher at the bundled runtime.',
    '',
  ].join('\n'),
  'utf8',
)
runTar(tarballPath, bundleName)
process.stdout.write(`Created standalone server bundle: ${tarballPath}\n`)
