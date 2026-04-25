import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CONTROL_SURFACE_PROTOCOL_VERSION,
  WORKER_CONTROL_SURFACE_CONNECTION_FILE,
} from './constants.mjs'
import { invokeControlSurface } from './invoke.mjs'

export class WorkerLifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkerLifecycleError'
    this.code = code
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEnvPath(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function resolveAppDataDir() {
  const homedir = os.homedir()

  if (process.platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support')
  }

  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming')
  }

  return process.env.XDG_CONFIG_HOME || path.join(homedir, '.config')
}

export function resolveWorkerUserDataCandidates(explicitUserData, explicitCandidates) {
  if (Array.isArray(explicitCandidates) && explicitCandidates.length > 0) {
    return [...new Set(explicitCandidates.map(candidate => path.resolve(candidate)))]
  }

  const explicit = normalizeEnvPath(explicitUserData)
  if (explicit) {
    return [path.resolve(explicit)]
  }

  const candidates = []
  const envUserData = normalizeEnvPath(process.env.OPENCOVE_USER_DATA_DIR)
  if (envUserData) {
    candidates.push(path.resolve(envUserData))
  }

  const appDataDir = resolveAppDataDir()
  candidates.push(path.join(appDataDir, 'opencove-dev'))
  candidates.push(path.join(appDataDir, 'opencove'))

  return [...new Set(candidates)]
}

export function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeStartedBy(value) {
  return value === 'cli' || value === 'desktop' ? value : 'unknown'
}

function normalizeConnectionInfo(value, userDataPath, processAlive) {
  if (!isRecord(value)) {
    return null
  }

  if (value.version !== 1) {
    return null
  }

  const hostname = typeof value.hostname === 'string' ? value.hostname.trim() : ''
  const token = typeof value.token === 'string' ? value.token.trim() : ''
  const port = value.port
  const pid = value.pid
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt.trim() : ''

  if (hostname.length === 0 || token.length === 0 || createdAt.length === 0) {
    return null
  }

  if (!Number.isFinite(port) || port <= 0 || !Number.isFinite(pid) || pid <= 0) {
    return null
  }

  return {
    version: 1,
    pid,
    hostname,
    port,
    token,
    createdAt,
    startedBy: normalizeStartedBy(value.startedBy),
    userDataPath,
    processAlive,
  }
}

async function readWorkerConnection(userDataPath, processAliveFn) {
  const filePath = path.join(userDataPath, WORKER_CONTROL_SURFACE_CONNECTION_FILE)

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const pid = isRecord(parsed) && typeof parsed.pid === 'number' ? parsed.pid : NaN
    return normalizeConnectionInfo(parsed, userDataPath, processAliveFn(pid))
  } catch {
    return null
  }
}

export async function listWorkerConnections(options = {}) {
  const processAliveFn = options.isProcessAlive ?? isProcessAlive
  const userDataCandidates = resolveWorkerUserDataCandidates(
    options.userData,
    options.userDataCandidates,
  )
  const connections = await Promise.all(
    userDataCandidates.map(userDataPath => readWorkerConnection(userDataPath, processAliveFn)),
  )

  return connections
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

async function isWorkerReachable(connection, timeoutMs) {
  if (!connection.processAlive) {
    return false
  }

  try {
    const endpoint = {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    }

    const pingResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.ping', payload: null },
      { timeoutMs },
    )
    if (pingResponse.httpStatus !== 200 || pingResponse.result?.ok !== true) {
      return false
    }

    const capabilitiesResponse = await invokeControlSurface(
      endpoint,
      { kind: 'query', id: 'system.capabilities', payload: null },
      { timeoutMs },
    )
    if (capabilitiesResponse.httpStatus !== 200 || capabilitiesResponse.result?.ok !== true) {
      return false
    }

    const capabilities = capabilitiesResponse.result.value
    const protocolVersion = isRecord(capabilities) ? capabilities.protocolVersion : null
    return protocolVersion === CONTROL_SURFACE_PROTOCOL_VERSION
  } catch {
    return false
  }
}

function toPublicWorkerStatus(connection, reachable) {
  return {
    status: connection.processAlive && reachable ? 'running' : 'stopped',
    pid: connection.pid,
    hostname: connection.hostname,
    port: connection.port,
    userDataPath: connection.userDataPath,
    startedBy: connection.startedBy,
    createdAt: connection.createdAt,
    reachable,
  }
}

export async function getWorkerLifecycleStatus(options = {}) {
  const connections = await listWorkerConnections(options)
  const timeoutMs = options.timeoutMs
  const workers = await Promise.all(
    connections.map(async connection => {
      const reachable = await isWorkerReachable(connection, timeoutMs)
      return toPublicWorkerStatus(connection, reachable)
    }),
  )
  const runningCount = workers.filter(worker => worker.status === 'running').length

  return {
    status: runningCount === 0 ? 'stopped' : runningCount === 1 ? 'running' : 'multiple',
    workers: options.all ? workers : workers.filter(worker => worker.status === 'running'),
  }
}

function parsePid(value) {
  if (value === null || value === undefined) {
    return null
  }

  const pid = Number(value)
  if (!Number.isFinite(pid) || pid <= 0 || Math.floor(pid) !== pid) {
    throw new WorkerLifecycleError('invalid_pid', `[opencove] invalid worker pid: ${value}`)
  }

  return pid
}

function selectStopTarget(connections, options) {
  const pid = parsePid(options.pid)
  const alive = connections.filter(connection => connection.processAlive)
  const candidates = pid ? alive.filter(connection => connection.pid === pid) : alive

  if (candidates.length === 0) {
    return null
  }

  if (candidates.length > 1) {
    throw new WorkerLifecycleError(
      'ambiguous_worker',
      '[opencove] multiple local workers are running; pass --user-data <dir> or --pid <pid>.',
    )
  }

  return candidates[0]
}

async function waitForPidExit(pid, options) {
  const isAlive = options.isProcessAlive ?? isProcessAlive
  const timeoutMs = options.timeoutMs ?? 5_000

  return await new Promise(resolvePromise => {
    const startedAt = Date.now()
    const finish = value => {
      clearInterval(interval)
      resolvePromise(value)
    }
    const interval = setInterval(() => {
      if (!isAlive(pid)) {
        finish(true)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        finish(!isAlive(pid))
      }
    }, 100)

    if (!isAlive(pid)) {
      finish(true)
    }
  })
}

export async function stopWorkerLifecycle(options = {}) {
  const connections = await listWorkerConnections(options)
  const target = selectStopTarget(connections, options)

  if (!target) {
    return { status: 'stopped', stopped: false, reason: 'not_running' }
  }

  const force = options.force === true

  if (target.startedBy !== 'cli' && !force) {
    throw new WorkerLifecycleError(
      'not_cli_owned',
      `[opencove] refusing to stop ${target.startedBy} worker pid ${target.pid}; pass --force to override.`,
    )
  }

  if (!force && !(await isWorkerReachable(target, options.timeoutMs))) {
    throw new WorkerLifecycleError(
      'unreachable_worker',
      `[opencove] refusing to stop unreachable worker pid ${target.pid}; pass --force to override.`,
    )
  }

  const sendSignal =
    options.sendSignal ??
    ((pid, signal) => {
      process.kill(pid, signal)
    })

  sendSignal(target.pid, 'SIGTERM')
  let exited = await waitForPidExit(target.pid, {
    isProcessAlive: options.isProcessAlive,
    timeoutMs: options.stopTimeoutMs,
  })

  if (!exited && force) {
    sendSignal(target.pid, 'SIGKILL')
    exited = await waitForPidExit(target.pid, {
      isProcessAlive: options.isProcessAlive,
      timeoutMs: options.stopTimeoutMs,
    })
  }

  if (!exited) {
    throw new WorkerLifecycleError(
      'stop_timeout',
      `[opencove] worker pid ${target.pid} did not exit before timeout.`,
    )
  }

  return {
    status: 'stopped',
    stopped: true,
    pid: target.pid,
    userDataPath: target.userDataPath,
    startedBy: target.startedBy,
    forced: force,
  }
}

export function printWorkerLifecycleResult(value, pretty) {
  const result = {
    __opencoveControlEnvelope: true,
    ok: true,
    value,
  }
  process.stdout.write(`${pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`)
}
