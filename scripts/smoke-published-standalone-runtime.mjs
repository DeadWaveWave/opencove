#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertPublishedAssetChecksum,
  assertPublishedChecksumInventory,
  resolvePublishedStandaloneReleaseTarget,
} from './lib/published-standalone-smoke.mjs'

const [, , rawTag, rawInstallerSource = '--installer-source=tag'] = process.argv
if (!rawTag || !rawInstallerSource.startsWith('--installer-source=')) {
  process.stderr.write(
    'Usage: node scripts/smoke-published-standalone-runtime.mjs <vX.Y.Z> [--installer-source=tag|latest]\n',
  )
  process.exit(2)
}

const installerSource = rawInstallerSource.slice('--installer-source='.length)
if (installerSource !== 'tag' && installerSource !== 'latest') {
  throw new Error(`Unsupported installer source: ${installerSource}`)
}
const target = resolvePublishedStandaloneReleaseTarget({
  tag: rawTag,
  platform: process.platform,
  arch: process.arch,
  ...(process.env['OPENCOVE_RELEASE_ROOT']
    ? { releaseRoot: process.env['OPENCOVE_RELEASE_ROOT'] }
    : {}),
})
if (installerSource === 'latest' && !target.stable) {
  throw new Error('Nightly releases do not own latest-stable installer aliases.')
}

const selectedInstaller =
  installerSource === 'latest'
    ? { name: target.latestInstallerName, url: target.latestInstallerUrl }
    : { name: target.installerName, url: target.installerUrl }
const selectedUninstaller =
  installerSource === 'latest'
    ? { name: target.latestUninstallerName, url: target.latestUninstallerUrl }
    : { name: target.uninstallerName, url: target.uninstallerUrl }
if (
  !selectedInstaller.name ||
  !selectedInstaller.url ||
  !selectedUninstaller.name ||
  !selectedUninstaller.url
) {
  throw new Error(`Published ${installerSource} installer assets are unavailable for ${target.tag}`)
}

const smokeRoot = await mkdtemp(join(tmpdir(), 'opencove-published-release-'))
const installRoot = join(smokeRoot, 'install')
const binDir = join(smokeRoot, 'bin')
const userDataDir = join(smokeRoot, 'user-data')
const isolatedHome = join(smokeRoot, 'home')
const installerPath = join(smokeRoot, selectedInstaller.name)
const uninstallerPath = join(smokeRoot, selectedUninstaller.name)
const connectionPath = join(userDataDir, 'worker-control-surface.json')
const launcherPath = join(binDir, process.platform === 'win32' ? 'opencove.cmd' : 'opencove')
const PASSTHROUGH_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'ComSpec',
  'COMSPEC',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_ARCHITEW6432',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
]
const commandEnvironment = Object.fromEntries(
  PASSTHROUGH_ENV_KEYS.flatMap(key =>
    typeof process.env[key] === 'string' ? [[key, process.env[key]]] : [],
  ),
)
Object.assign(commandEnvironment, {
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  XDG_CONFIG_HOME: join(isolatedHome, '.config'),
  XDG_DATA_HOME: join(isolatedHome, '.local', 'share'),
  XDG_STATE_HOME: join(isolatedHome, '.local', 'state'),
  APPDATA: join(isolatedHome, 'AppData', 'Roaming'),
  LOCALAPPDATA: join(isolatedHome, 'AppData', 'Local'),
  OPENCOVE_INSTALL_ROOT: installRoot,
  OPENCOVE_BIN_DIR: binDir,
})
let workerProcess = null
let workerPid = null
let workerOutput = ''
let installAttempted = false
let uninstalled = false

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function downloadBuffer(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'opencove-published-release-smoke' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function resolveInvocation(command, args) {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args }
  }

  const quote = value => {
    if (/[\r\n"]/u.test(value)) {
      throw new Error(`Unsupported Windows command argument: ${value}`)
    }
    return `"${value}"`
  }
  return {
    command: process.env['ComSpec'] || 'cmd.exe',
    args: ['/d', '/s', '/c', `call ${quote(command)} ${args.map(quote).join(' ')}`],
  }
}

function runCommand(command, args, options = {}) {
  const invocation = resolveInvocation(command, args)
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: options.env ?? process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
    }, options.timeoutMs ?? 120_000)
    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', exitCode => {
      clearTimeout(timeout)
      if (exitCode !== 0) {
        reject(
          new Error(
            `Command failed (${String(exitCode)}): ${command} ${args.join(' ')}\n${stderr || stdout}`,
          ),
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function invokePowerShellScript(path) {
  return await runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path],
    { env: commandEnvironment, timeoutMs: 600_000 },
  )
}

async function invokeInstaller() {
  installAttempted = true
  const result =
    process.platform === 'win32'
      ? await invokePowerShellScript(installerPath)
      : await runCommand('sh', [installerPath], {
          env: commandEnvironment,
          timeoutMs: 600_000,
        })
  if (!`${result.stdout}\n${result.stderr}`.includes(`Verified SHA256 for ${target.bundleName}`)) {
    throw new Error(`Published installer did not verify ${target.bundleName}`)
  }
}

async function invokeUninstaller() {
  if (process.platform === 'win32') {
    await invokePowerShellScript(uninstallerPath)
    return
  }
  await runCommand('sh', [uninstallerPath], {
    env: commandEnvironment,
    timeoutMs: 120_000,
  })
}

async function readReadyConnection(deadline = Date.now() + 30_000) {
  if (workerProcess?.exitCode !== null) {
    throw new Error(`Published Worker exited before readiness.\n${workerOutput}`)
  }
  try {
    const connection = JSON.parse(await readFile(connectionPath, 'utf8'))
    if (
      connection?.startedBy === 'cli' &&
      Number.isInteger(connection.pid) &&
      Number.isInteger(connection.port) &&
      typeof connection.hostname === 'string' &&
      typeof connection.token === 'string'
    ) {
      return connection
    }
  } catch {
    // The connection file is published atomically; absence means startup is still in progress.
  }
  if (Date.now() >= deadline) {
    throw new Error(`Published Worker did not become ready.\n${workerOutput}`)
  }
  await delay(250)
  return await readReadyConnection(deadline)
}

async function waitForWorkerLauncherExit(timeoutMs) {
  if (!workerProcess || workerProcess.exitCode !== null) {
    return true
  }
  return await new Promise(resolve => {
    const timeout = setTimeout(() => {
      workerProcess?.removeListener('exit', handleExit)
      resolve(false)
    }, timeoutMs)
    const handleExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    workerProcess.once('exit', handleExit)
  })
}

async function invokeControlSurface(connection, id) {
  const response = await fetch(`http://${connection.hostname}:${String(connection.port)}/invoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ kind: 'query', id, payload: null }),
    signal: AbortSignal.timeout(5_000),
  })
  const body = await response.json()
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      `Published Worker ${id} failed: HTTP ${response.status} ${JSON.stringify(body)}`,
    )
  }
  return body.value
}

async function stopWorker() {
  if (!workerProcess || workerProcess.exitCode !== null) {
    return
  }
  await runCommand(launcherPath, ['worker', 'stop', '--user-data', userDataDir], {
    env: commandEnvironment,
    timeoutMs: 30_000,
  })
  if (!(await waitForWorkerLauncherExit(10_000))) {
    workerProcess.kill()
    throw new Error('Published Worker launcher did not exit after an ownership-safe stop.')
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function assertUninstallPostconditions() {
  const forbiddenPaths = [launcherPath, join(installRoot, 'current')]
  const residualPaths = (
    await Promise.all(forbiddenPaths.map(async path => ({ path, exists: await pathExists(path) })))
  ).filter(candidate => candidate.exists)
  if (residualPaths.length > 0) {
    throw new Error(
      `Published uninstaller left runtime paths behind: ${residualPaths.map(candidate => candidate.path).join(', ')}`,
    )
  }
  const installEntries = (await readdir(installRoot).catch(() => [])).filter(
    entry => entry === 'current' || entry.startsWith('opencove-server-'),
  )
  if (installEntries.length > 0) {
    throw new Error(
      `Published uninstaller left runtime entries behind: ${installEntries.join(', ')}`,
    )
  }
}

let primaryError = null
let cleanupError = null
try {
  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(isolatedHome, { recursive: true }),
  ])
  const [installer, uninstaller, checksumBytes] = await Promise.all([
    downloadBuffer(selectedInstaller.url),
    downloadBuffer(selectedUninstaller.url),
    downloadBuffer(target.checksumsUrl),
  ])
  const checksums = checksumBytes.toString('utf8')
  assertPublishedChecksumInventory(checksums, target)
  assertPublishedAssetChecksum(installer, checksums, selectedInstaller.name)
  assertPublishedAssetChecksum(uninstaller, checksums, selectedUninstaller.name)

  if (installerSource === 'tag' && target.stable) {
    const aliases = await Promise.all([
      downloadBuffer(target.stableAliasInstallerAssetUrl),
      downloadBuffer(target.stableAliasUninstallerAssetUrl),
    ])
    assertPublishedAssetChecksum(aliases[0], checksums, target.latestInstallerName)
    assertPublishedAssetChecksum(aliases[1], checksums, target.latestUninstallerName)
  }

  const installerText = installer.toString('utf8')
  const expectedBase =
    installerSource === 'latest' ? '/releases/latest/download' : `/releases/download/${target.tag}`
  if (!installerText.includes(expectedBase)) {
    throw new Error(`Published installer is not pinned to ${expectedBase}`)
  }

  await Promise.all([writeFile(installerPath, installer), writeFile(uninstallerPath, uninstaller)])
  if (process.platform !== 'win32') {
    await Promise.all([chmod(installerPath, 0o755), chmod(uninstallerPath, 0o755)])
  }

  await invokeInstaller()
  await runCommand(launcherPath, ['worker', 'start', '--help'], {
    env: commandEnvironment,
    timeoutMs: 30_000,
  })

  const invocation = resolveInvocation(launcherPath, [
    'worker',
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    '0',
    '--token=published-release-smoke-token',
    '--user-data',
    userDataDir,
  ])
  workerProcess = spawn(invocation.command, invocation.args, {
    env: commandEnvironment,
    windowsHide: true,
  })
  workerProcess.stdout?.on('data', chunk => {
    workerOutput += String(chunk)
  })
  workerProcess.stderr?.on('data', chunk => {
    workerOutput += String(chunk)
  })

  const connection = await readReadyConnection()
  workerPid = connection.pid
  if (connection.appVersion !== target.version) {
    throw new Error(
      `Published Worker version mismatch: expected ${target.version}, received ${String(connection.appVersion)}`,
    )
  }
  await invokeControlSurface(connection, 'system.ping')
  const capabilities = await invokeControlSurface(connection, 'system.capabilities')
  if (capabilities?.appVersion !== target.version) {
    throw new Error(
      `Published Worker capabilities mismatch: expected ${target.version}, received ${String(capabilities?.appVersion)}`,
    )
  }

  await stopWorker()
  await invokeUninstaller()
  await assertUninstallPostconditions()
  uninstalled = true
} catch (error) {
  primaryError = error
} finally {
  try {
    await stopWorker()
  } catch (error) {
    cleanupError = error
    if (Number.isInteger(workerPid)) {
      try {
        process.kill(workerPid)
      } catch {
        // The Worker may already have exited while cleanup was racing it.
      }
    }
    if (workerProcess?.exitCode === null) {
      workerProcess.kill()
    }
  }
  if (installAttempted && !uninstalled && (await pathExists(uninstallerPath))) {
    try {
      await invokeUninstaller()
      await assertUninstallPostconditions()
      uninstalled = true
    } catch (error) {
      cleanupError ??= error
    }
  }
  await rm(smokeRoot, { recursive: true, force: true })
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    'Published release smoke and cleanup failed.',
  )
}
if (primaryError) {
  throw primaryError
}
if (cleanupError) {
  throw cleanupError
}
process.stdout.write(
  `Published standalone smoke passed: ${target.tag} ${target.platform}-${target.arch} via ${installerSource}; installer/uninstaller SHA256, Worker ping/version, and cleanup are valid.\n`,
)
