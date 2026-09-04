#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertPublishedChecksumInventory,
  resolvePublishedStandaloneReleaseTarget,
} from './lib/published-standalone-smoke.mjs'

const [, , rawTag] = process.argv
if (!rawTag) {
  process.stderr.write('Usage: node scripts/smoke-published-standalone-runtime.mjs <vX.Y.Z>\n')
  process.exit(2)
}

const target = resolvePublishedStandaloneReleaseTarget({
  tag: rawTag,
  platform: process.platform,
  arch: process.arch,
  ...(process.env['OPENCOVE_RELEASE_ROOT']
    ? { releaseRoot: process.env['OPENCOVE_RELEASE_ROOT'] }
    : {}),
})
const smokeRoot = await mkdtemp(join(tmpdir(), 'opencove-published-release-'))
const installRoot = join(smokeRoot, 'install')
const binDir = join(smokeRoot, 'bin')
const userDataDir = join(smokeRoot, 'user-data')
const installerPath = join(smokeRoot, target.installerName)
const latestInstallerPath = target.latestInstallerName
  ? join(smokeRoot, target.latestInstallerName)
  : null
const connectionPath = join(userDataDir, 'worker-control-surface.json')
const launcherPath = join(binDir, process.platform === 'win32' ? 'opencove.cmd' : 'opencove')
const commandEnvironment = {
  ...process.env,
  OPENCOVE_INSTALL_ROOT: installRoot,
  OPENCOVE_BIN_DIR: binDir,
}
let workerProcess = null
let workerPid = null
let workerOutput = ''
let installed = false

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function downloadText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'opencove-published-release-smoke' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`)
  }
  return await response.text()
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

async function invokeInstaller(uninstall = false) {
  if (process.platform === 'win32') {
    await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
        ...(uninstall ? ['-Uninstall'] : []),
      ],
      { env: commandEnvironment, timeoutMs: 600_000 },
    )
    return
  }

  await runCommand('sh', [installerPath, ...(uninstall ? ['--uninstall'] : [])], {
    env: commandEnvironment,
    timeoutMs: 600_000,
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

let primaryError = null
let cleanupError = null
try {
  await mkdir(userDataDir, { recursive: true })
  const [installer, checksums, latestInstaller] = await Promise.all([
    downloadText(target.installerUrl),
    downloadText(target.checksumsUrl),
    target.latestInstallerUrl ? downloadText(target.latestInstallerUrl) : Promise.resolve(null),
  ])
  assertPublishedChecksumInventory(checksums, target)

  const expectedVersionBase = `/releases/download/${target.tag}`
  if (!installer.includes(expectedVersionBase)) {
    throw new Error(`Versioned installer is not pinned to ${expectedVersionBase}`)
  }
  if (latestInstaller !== null && !latestInstaller.includes('/releases/latest/download')) {
    throw new Error('Latest stable installer does not resolve through releases/latest/download.')
  }

  await writeFile(installerPath, installer, 'utf8')
  if (process.platform !== 'win32') {
    await chmod(installerPath, 0o755)
  }
  if (latestInstallerPath && latestInstaller !== null) {
    await writeFile(latestInstallerPath, latestInstaller, 'utf8')
  }

  await invokeInstaller()
  installed = true
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
  if (installed) {
    try {
      await invokeInstaller(true)
      installed = false
    } catch (error) {
      cleanupError ??= error
    }
  }
  await rm(smokeRoot, { recursive: true, force: true })
}

if (primaryError) {
  throw primaryError
}
if (cleanupError) {
  throw cleanupError
}
process.stdout.write(
  `Published standalone smoke passed: ${target.tag} ${target.platform}-${target.arch}; installer, checksum, launcher, Worker ping, and version are valid.\n`,
)
