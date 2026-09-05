import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { WorkerConnectionInfoDto, WorkerStatusResult } from '../../../shared/contracts/dto'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'
import { resolvePackagedWorkerScriptPath } from '../../../shared/runtime/opencoveRuntimePaths'
import { removeConnectionFile } from '../controlSurface/http/connectionFile'
import { removeWorkerSingleInstanceLock } from '../../../platform/process/workerSingleInstanceLockFile'
import {
  isReusableLocalWorkerConnection,
  resolveLocalWorkerReusePolicy,
} from './localWorkerCompatibility'
import { parseWorkerReadyPayload } from './workerReadyPayload'
import { readRuntimeAppVersion } from '../controlSurface/runtimeAppVersion'
import {
  buildLocalWorkerSpawnArgs,
  isTruthyEnv,
  resolveForwardedLocalWorkerDiagnosticsEnv,
} from './localWorkerSpawn'
import { terminateStaleLocalWorkerTree } from './staleLocalWorkerProcessTree'
import { LOCAL_WORKER_STOP_TIMEOUT_MS } from '../../../shared/runtime/controlSurfaceShutdown'
import { resolveLocalWorkerWebUiUrl } from './localWorkerWebUiUrl'

export { buildLocalWorkerSpawnArgs, isTruthyEnv, resolveForwardedLocalWorkerDiagnosticsEnv }

function resolveWorkerScriptPath(): string {
  if (app.isPackaged) {
    return resolvePackagedWorkerScriptPath(process.resourcesPath)
  }

  return resolve(app.getAppPath(), 'out', 'main', 'worker.js')
}

function toDto(info: {
  version: number
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
  appVersion: string | null
  startedBy?: 'cli' | 'desktop'
}): WorkerConnectionInfoDto {
  return {
    version: info.version,
    pid: info.pid,
    hostname: info.hostname,
    port: info.port,
    token: info.token,
    createdAt: info.createdAt,
    appVersion: info.appVersion,
    ...(info.startedBy ? { startedBy: info.startedBy } : {}),
  }
}

async function resolveConnectionFromUserData(options?: {
  requireLivePid?: boolean
}): Promise<WorkerConnectionInfoDto | null> {
  const info = await resolveControlSurfaceConnectionInfoFromUserData({
    userDataPath: app.getPath('userData'),
    fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
    requireLivePid: options?.requireLivePid,
  })

  return info ? toDto(info) : null
}

type WorkerChildProcess = ChildProcessByStdio<null, Readable, Readable>

let activeWorkerChild: WorkerChildProcess | null = null
let startLocalWorkerPromise: Promise<WorkerStatusResult> | null = null
let localWorkerShutdownRequested = false

function stoppedWorkerStatus(): WorkerStatusResult {
  return { status: 'stopped', connection: null }
}

export function beginLocalWorkerShutdown(): void {
  localWorkerShutdownRequested = true
}

function childHasExited(child: WorkerChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function stopChild(child: WorkerChildProcess): Promise<void> {
  if (child.killed || childHasExited(child)) {
    return
  }

  await new Promise<void>(resolvePromise => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        child.kill()
      }
    }, LOCAL_WORKER_STOP_TIMEOUT_MS)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolvePromise()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      child.kill()
    }
  })
}

async function stopByPid(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid)
    } catch {
      // ignore
    }
  }
}

export async function repairStaleLocalWorkerFiles(
  userDataPath: string,
  stalePid?: number | null,
): Promise<void> {
  if (typeof stalePid === 'number' && Number.isFinite(stalePid) && stalePid > 0) {
    await terminateStaleLocalWorkerTree({ stalePid, userDataPath }).catch(() => undefined)
  }

  await removeConnectionFile(userDataPath, WORKER_CONTROL_SURFACE_CONNECTION_FILE).catch(
    () => undefined,
  )
  await removeWorkerSingleInstanceLock(userDataPath).catch(() => undefined)
}

export type OwnedLocalWorkerConfigurationState =
  | { state: 'absent'; connection: null }
  | { state: 'external'; connection: WorkerConnectionInfoDto }
  | { state: 'starting'; connection: null }
  | { state: 'ready'; connection: WorkerConnectionInfoDto }
  | { state: 'unreachable'; connection: WorkerConnectionInfoDto }

export async function resolveOwnedLocalWorkerConfigurationState(): Promise<OwnedLocalWorkerConfigurationState> {
  const connection = await resolveConnectionFromUserData({ requireLivePid: true })
  if (!connection) {
    return startLocalWorkerPromise || hasOwnedLocalWorkerProcess()
      ? { state: 'starting', connection: null }
      : { state: 'absent', connection: null }
  }
  if (connection.startedBy !== 'desktop') {
    return { state: 'external', connection }
  }
  const policy = resolveLocalWorkerReusePolicy(connection, { launcherStartedBy: 'desktop' })
  if (!policy.canReuse) {
    return { state: 'unreachable', connection }
  }
  return (await isReusableLocalWorkerConnection(connection))
    ? { state: 'ready', connection }
    : { state: 'unreachable', connection }
}

export async function getLocalWorkerStatus(): Promise<WorkerStatusResult> {
  const connection = await resolveConnectionFromUserData()
  if (!connection) {
    return { status: 'stopped', connection: null }
  }

  return (await isReusableLocalWorkerConnection(connection))
    ? { status: 'running', connection }
    : { status: 'stopped', connection: null }
}

export function hasOwnedLocalWorkerProcess(): boolean {
  return activeWorkerChild !== null && !childHasExited(activeWorkerChild)
}

export async function stopOwnedLocalWorker(): Promise<boolean> {
  const child = activeWorkerChild
  activeWorkerChild = null

  if (!child) {
    return false
  }

  if (childHasExited(child)) {
    return true
  }

  await stopChild(child)
  return true
}

async function waitForExistingWorkerConnection(
  timeoutMs: number,
): Promise<WorkerConnectionInfoDto | null> {
  const deadlineMs = Date.now() + timeoutMs

  const poll = async (): Promise<WorkerConnectionInfoDto | null> => {
    const connection = await resolveConnectionFromUserData({ requireLivePid: false })
    if (connection && (await isReusableLocalWorkerConnection(connection))) {
      return connection
    }

    if (Date.now() >= deadlineMs) {
      return null
    }

    await new Promise<void>(resolvePromise => {
      setTimeout(resolvePromise, 150).unref()
    })

    return await poll()
  }

  return await poll()
}

function spawnWorkerChild(args: string[], userDataPath: string): WorkerChildProcess {
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCOVE_USER_DATA_DIR: userDataPath,
      ...(isTruthyEnv(process.env['OPENCOVE_DEV_USE_SHARED_USER_DATA'])
        ? { OPENCOVE_DEV_USE_SHARED_USER_DATA: '1' }
        : {}),
      ...resolveForwardedLocalWorkerDiagnosticsEnv(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  activeWorkerChild = child
  child.once('exit', () => {
    if (activeWorkerChild === child) {
      activeWorkerChild = null
    }
  })

  child.stderr.on('data', chunk => {
    process.stderr.write(chunk)
  })

  return child
}

async function waitForWorkerReadyPayload(
  child: WorkerChildProcess,
): Promise<WorkerConnectionInfoDto> {
  return await new Promise<WorkerConnectionInfoDto>((resolvePromise, rejectPromise) => {
    const rl = createInterface({ input: child.stdout })
    // Closing readline pauses its input. Continue draining after the private ready handshake:
    // an unread stdout pipe can block the Worker (including health checks) when it logs.
    rl.once('close', () => child.stdout.resume())
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      rl.close()
      rejectPromise(new Error('Timed out waiting for worker ready payload'))
    }, 7_500)

    const resolveReady = (info: WorkerConnectionInfoDto): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      rl.close()
      resolvePromise(info)
    }

    const rejectReady = (error: Error): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      rl.close()
      rejectPromise(error)
    }

    rl.on('line', line => {
      try {
        const parsed = JSON.parse(line) as unknown
        const info = parseWorkerReadyPayload(parsed)
        if (!info) {
          return
        }

        resolveReady(info)
      } catch {
        // ignore non-JSON output
      }
    })

    child.once('exit', code => {
      rejectReady(new Error(`Worker exited before ready (code=${code ?? 1})`))
    })
  })
}

async function spawnWorkerAndWaitForLiveConnection(
  args: string[],
  userDataPath: string,
): Promise<WorkerConnectionInfoDto> {
  const child = spawnWorkerChild(args, userDataPath)
  const info = await waitForWorkerReadyPayload(child)

  if (!(await isReusableLocalWorkerConnection(info))) {
    await stopOwnedLocalWorker().catch(() => undefined)
    await repairStaleLocalWorkerFiles(userDataPath, null)
    throw new Error('Worker ready payload endpoint is not reachable')
  }

  return info
}

async function recoverAfterFailedWorkerStart(
  userDataPath: string,
): Promise<WorkerConnectionInfoDto | null> {
  await stopOwnedLocalWorker().catch(() => undefined)

  const racedConnection = await waitForExistingWorkerConnection(1_500)
  if (racedConnection) {
    return racedConnection
  }

  await repairStaleLocalWorkerFiles(userDataPath, null)
  return null
}

async function startLocalWorkerInternal(): Promise<WorkerStatusResult> {
  if (localWorkerShutdownRequested) {
    return stoppedWorkerStatus()
  }
  const userDataPath = app.getPath('userData')
  const existing = await resolveConnectionFromUserData({ requireLivePid: false })
  if (existing) {
    // The ChildProcess owns liveness after startup. A brief health-probe timeout under load
    // is not evidence of process death and must not kill the Worker's live terminal sessions.
    if (
      activeWorkerChild?.pid === existing.pid &&
      !childHasExited(activeWorkerChild) &&
      resolveLocalWorkerReusePolicy(existing).canReuse
    ) {
      return { status: 'running', connection: existing }
    }
    if (await isReusableLocalWorkerConnection(existing)) {
      return { status: 'running', connection: existing }
    }

    await repairStaleLocalWorkerFiles(userDataPath, existing.pid)
  }

  const workerScriptPath = resolveWorkerScriptPath()
  if (!existsSync(workerScriptPath)) {
    throw new Error(
      `Local worker entry is missing: ${workerScriptPath}. Run \`pnpm build\` once before using Worker/Web UI in dev.`,
    )
  }

  const appVersion = readRuntimeAppVersion()
  const args = buildLocalWorkerSpawnArgs({
    workerScriptPath,
    userDataPath,
    parentPid: process.pid,
    bindHostname: '127.0.0.1',
    advertiseHostname: '127.0.0.1',
    port: 0,
    enableWebUi: false,
    webUiPasswordHash: null,
    appVersion,
  })

  if (localWorkerShutdownRequested) {
    return stoppedWorkerStatus()
  }

  try {
    const info = await spawnWorkerAndWaitForLiveConnection(args, userDataPath)
    if (localWorkerShutdownRequested) {
      await stopOwnedLocalWorker().catch(() => undefined)
      return stoppedWorkerStatus()
    }
    return { status: 'running', connection: info }
  } catch (firstError) {
    if (localWorkerShutdownRequested) {
      await stopOwnedLocalWorker().catch(() => undefined)
      return stoppedWorkerStatus()
    }
    const recoveredConnection = await recoverAfterFailedWorkerStart(userDataPath)
    if (localWorkerShutdownRequested) {
      await stopOwnedLocalWorker().catch(() => undefined)
      return stoppedWorkerStatus()
    }
    if (recoveredConnection) {
      return { status: 'running', connection: recoveredConnection }
    }

    try {
      const retryInfo = await spawnWorkerAndWaitForLiveConnection(args, userDataPath)
      if (localWorkerShutdownRequested) {
        await stopOwnedLocalWorker().catch(() => undefined)
        return stoppedWorkerStatus()
      }
      return { status: 'running', connection: retryInfo }
    } catch (retryError) {
      await stopOwnedLocalWorker().catch(() => undefined)
      if (localWorkerShutdownRequested) {
        return stoppedWorkerStatus()
      }
      throw retryError instanceof Error ? retryError : firstError
    }
  }
}

export function startLocalWorker(): Promise<WorkerStatusResult> {
  if (localWorkerShutdownRequested) {
    return Promise.resolve(stoppedWorkerStatus())
  }
  if (startLocalWorkerPromise) {
    return startLocalWorkerPromise
  }

  const operation = startLocalWorkerInternal()
  startLocalWorkerPromise = operation

  void operation
    .finally(() => {
      if (startLocalWorkerPromise === operation) {
        startLocalWorkerPromise = null
      }
    })
    .catch(() => undefined)

  return operation
}

export async function stopLocalWorker(): Promise<WorkerStatusResult> {
  if (await stopOwnedLocalWorker()) {
    return { status: 'stopped', connection: null }
  }

  const connection = await resolveConnectionFromUserData()
  if (connection) {
    await stopByPid(connection.pid)
  }

  return await getLocalWorkerStatus()
}

export async function getLocalWorkerWebUiUrl(): Promise<string | null> {
  return await resolveLocalWorkerWebUiUrl(async () => await resolveConnectionFromUserData())
}
