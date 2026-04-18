import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { WorkerConnectionInfoDto, WorkerStatusResult } from '../../../shared/contracts/dto'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'
import { readHomeWorkerConfigFile } from './homeWorkerConfig'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function resolveWorkerScriptPath(): string {
  return resolve(app.getAppPath(), 'out', 'main', 'worker.js')
}

export function buildLocalWorkerSpawnArgs(options: {
  workerScriptPath: string
  userDataPath: string
  parentPid: number
  bindHostname: string
  advertiseHostname: string
  port: number
  enableWebUi: boolean
  webUiPasswordHash: string | null
}): string[] {
  const args = [
    options.workerScriptPath,
    '--parent-pid',
    String(options.parentPid),
    '--hostname',
    options.bindHostname,
    '--port',
    String(options.port),
    '--user-data',
    options.userDataPath,
  ]

  if (!options.enableWebUi) {
    args.push('--disable-web-ui')
  }

  if (options.advertiseHostname !== options.bindHostname) {
    args.push('--advertise-hostname', options.advertiseHostname)
  }

  if (options.webUiPasswordHash) {
    args.push('--web-ui-password-hash', options.webUiPasswordHash)
  }

  return args
}

function toDto(info: {
  version: number
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
}): WorkerConnectionInfoDto {
  return {
    version: info.version,
    pid: info.pid,
    hostname: info.hostname,
    port: info.port,
    token: info.token,
    createdAt: info.createdAt,
  }
}

async function resolveConnectionFromUserData(): Promise<WorkerConnectionInfoDto | null> {
  const info = await resolveControlSurfaceConnectionInfoFromUserData({
    userDataPath: app.getPath('userData'),
    fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
  })

  return info ? toDto(info) : null
}

type WorkerChildProcess = ChildProcessByStdio<null, Readable, Readable>

let activeWorkerChild: WorkerChildProcess | null = null

function childHasExited(child: WorkerChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function isConnectionAlive(connection: WorkerConnectionInfoDto): Promise<boolean> {
  try {
    const endpoint = {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    }

    const pingResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.ping', payload: null },
      { timeoutMs: 750 },
    )
    if (pingResponse.httpStatus !== 200 || pingResponse.result?.ok !== true) {
      return false
    }

    const capabilitiesResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.capabilities', payload: null },
      { timeoutMs: 750 },
    )
    if (capabilitiesResponse.httpStatus !== 200 || capabilitiesResponse.result?.ok !== true) {
      return false
    }

    const capabilities = capabilitiesResponse.result.value
    const protocolVersion =
      capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
        ? (capabilities as Record<string, unknown>).protocolVersion
        : null
    if (protocolVersion !== CONTROL_SURFACE_PROTOCOL_VERSION) {
      return false
    }

    const endpointsResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'endpoint.list', payload: null },
      { timeoutMs: 750 },
    )

    return endpointsResponse.httpStatus === 200 && endpointsResponse.result?.ok === true
  } catch {
    return false
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return
  }

  const startedAtMs = Date.now()

  await new Promise<void>(resolvePromise => {
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - startedAtMs
      if (elapsedMs >= timeoutMs) {
        clearInterval(interval)
        resolvePromise()
        return
      }

      try {
        process.kill(pid, 0)
      } catch {
        clearInterval(interval)
        resolvePromise()
      }
    }, 100)

    interval.unref()
  })
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
    }, 7_500)

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

export async function getLocalWorkerStatus(): Promise<WorkerStatusResult> {
  const connection = await resolveConnectionFromUserData()
  if (!connection) {
    return { status: 'stopped', connection: null }
  }

  return (await isConnectionAlive(connection))
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

export async function startLocalWorker(): Promise<WorkerStatusResult> {
  const existing = await resolveConnectionFromUserData()
  if (existing) {
    if (await isConnectionAlive(existing)) {
      return { status: 'running', connection: existing }
    }

    await stopByPid(existing.pid)
    await waitForPidExit(existing.pid, 1_500)
  }

  const workerScriptPath = resolveWorkerScriptPath()
  if (!existsSync(workerScriptPath)) {
    throw new Error(
      `Local worker entry is missing: ${workerScriptPath}. Run \`pnpm build\` once before using Worker/Web UI in dev.`,
    )
  }

  const userDataPath = app.getPath('userData')
  const workerConfig = await readHomeWorkerConfigFile(userDataPath)
  const enableWebUi = workerConfig.webUi.enabled
  const port = workerConfig.webUi.port ?? 0
  const exposeOnLan = enableWebUi && workerConfig.webUi.exposeOnLan
  const bindHostname = exposeOnLan ? '0.0.0.0' : '127.0.0.1'
  const advertiseHostname = '127.0.0.1'
  const webUiPasswordHash = exposeOnLan ? workerConfig.webUi.passwordHash : null
  const args = buildLocalWorkerSpawnArgs({
    workerScriptPath,
    userDataPath,
    parentPid: process.pid,
    bindHostname,
    advertiseHostname,
    port,
    enableWebUi,
    webUiPasswordHash,
  })

  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCOVE_USER_DATA_DIR: userDataPath,
      ...(isTruthyEnv(process.env['OPENCOVE_DEV_USE_SHARED_USER_DATA'])
        ? { OPENCOVE_DEV_USE_SHARED_USER_DATA: '1' }
        : {}),
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

  const info = await new Promise<WorkerConnectionInfoDto>((resolvePromise, rejectPromise) => {
    const rl = createInterface({ input: child.stdout })

    const timeout = setTimeout(() => {
      rl.close()
      rejectPromise(new Error('Timed out waiting for worker ready payload'))
    }, 7_500)

    rl.on('line', line => {
      try {
        const parsed = JSON.parse(line) as unknown
        if (!parsed || typeof parsed !== 'object') {
          return
        }

        const record = parsed as Record<string, unknown>
        const hostname = typeof record.hostname === 'string' ? record.hostname : null
        const resolvedPort = typeof record.port === 'number' ? record.port : null
        const token = typeof record.token === 'string' ? record.token : null
        const pid = typeof record.pid === 'number' ? record.pid : null
        const version = typeof record.version === 'number' ? record.version : null
        const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null

        if (!hostname || !resolvedPort || !token || !pid || !version || !createdAt) {
          return
        }

        clearTimeout(timeout)
        rl.close()
        resolvePromise({
          version,
          pid,
          hostname,
          port: resolvedPort,
          token,
          createdAt,
        })
      } catch {
        // ignore non-JSON output
      }
    })

    child.once('exit', code => {
      clearTimeout(timeout)
      rl.close()
      rejectPromise(new Error(`Worker exited before ready (code=${code ?? 1})`))
    })
  })

  return { status: 'running', connection: info }
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

function normalizeTicketResult(value: unknown): { ticket: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid auth.issueWebSessionTicket response payload')
  }

  const ticket = (value as Record<string, unknown>).ticket
  if (typeof ticket !== 'string' || ticket.trim().length === 0) {
    throw new Error('Invalid auth.issueWebSessionTicket ticket value')
  }

  return { ticket: ticket.trim() }
}

export async function getLocalWorkerWebUiUrl(): Promise<string | null> {
  const connection = await resolveConnectionFromUserData()
  if (!connection) {
    return null
  }

  const workerConfig = await readHomeWorkerConfigFile(app.getPath('userData'))
  if (!workerConfig.webUi.enabled) {
    return null
  }

  if (workerConfig.webUi.exposeOnLan && workerConfig.webUi.passwordHash) {
    return `http://${connection.hostname}:${connection.port}/`
  }

  const { httpStatus, result } = await invokeControlSurface(
    {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    },
    {
      kind: 'query',
      id: 'auth.issueWebSessionTicket',
      payload: { redirectPath: '/' },
    },
  )

  if (httpStatus !== 200 || !result || result.ok !== true) {
    throw new Error('Failed to issue web session ticket')
  }

  const { ticket } = normalizeTicketResult(result.value)
  return `http://${connection.hostname}:${connection.port}/auth/claim?ticket=${encodeURIComponent(ticket)}`
}
