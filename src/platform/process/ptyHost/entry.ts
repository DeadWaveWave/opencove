import { spawnSync } from 'node:child_process'
import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
import { parentPort as workerParentPort } from 'node:worker_threads'
import { killWindowsProcessTree } from './windowsProcessTree'
import { ensureNodePtySpawnHelperExecutable } from './spawnHelperPermissions'
import {
  isPtyHostRequest,
  PTY_HOST_PROTOCOL_VERSION,
  type PtyHostMessage,
  type PtyHostSpawnRequest,
  type PtyHostWriteRequest,
  type PtyHostResizeRequest,
  type PtyHostKillRequest,
  type PtyHostShutdownRequest,
  type PtyHostCrashRequest,
} from './protocol'
import { convertHighByteX10MouseReportsToSgr } from '../pty/x10Mouse'
import { PtyHostSpawnIdentityRegistry } from './spawnIdentityRegistry'
import { resizePtyAndReadAck } from './resizeAck'
import { resolveForegroundAgentObservation } from '../../../shared/runtime/agentForegroundRecognition'
import { resolveShellCommandFinishedMarker } from '../../../shared/terminal/shellIntegration'
import { PtyHostForegroundObservationScheduler } from './foregroundObservationScheduler'

type ParentPort = {
  on: (event: 'message', listener: (messageEvent: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
  start: () => void
}

type ChildProcessPort = {
  on: (event: 'message', listener: (message: unknown) => void) => void
  send?: (message: unknown) => void
}

function resolveParentPort(): ParentPort {
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!parentPort) {
    const port = workerParentPort
    if (!port) {
      const childProcessPort = process as unknown as ChildProcessPort
      if (typeof childProcessPort.send !== 'function') {
        throw new Error('[pty-host] missing parent port')
      }

      return {
        on: (_event, listener) => {
          childProcessPort.on('message', message => {
            listener({ data: message })
          })
        },
        postMessage: message => {
          childProcessPort.send?.(message)
        },
        start: () => {
          // Node.js child_process IPC does not require an explicit start call.
        },
      }
    }

    return {
      on: (_event, listener) => {
        port.on('message', message => {
          listener({ data: message })
        })
      },
      postMessage: message => {
        port.postMessage(message)
      },
      start: () => {
        // Node.js worker_threads parentPort does not require an explicit start call.
      },
    }
  }

  return parentPort
}

const parentPort = resolveParentPort()
parentPort.start()
const hostInstanceId = crypto.randomUUID()

type PtySession = {
  pty: IPty
  rootPid: number | null
  launchId: string
}

const sessions = new Map<string, PtySession>()
const foregroundScheduler = new PtyHostForegroundObservationScheduler()
const shellIntegrationBuffers = new Map<string, string>()
const spawnIdentities = new PtyHostSpawnIdentityRegistry()
let hasCleanedSessions = false

function terminatePtySession(session: PtySession): void {
  const killResult = killWindowsProcessTree(session.rootPid)
  if (killResult === 'terminated' || killResult === 'not_found') {
    return
  }

  try {
    session.pty.kill()
  } catch {
    // ignore
  }
}

const cleanupSessions = (): void => {
  if (hasCleanedSessions) {
    return
  }

  hasCleanedSessions = true

  for (const [sessionId, session] of sessions.entries()) {
    sessions.delete(sessionId)
    spawnIdentities.release(session.launchId, sessionId)
    terminatePtySession(session)
  }
  foregroundScheduler.dispose()
  shellIntegrationBuffers.clear()
  spawnIdentities.clear()
}

ensureNodePtySpawnHelperExecutable()

process.once('SIGINT', () => {
  cleanupSessions()
  process.exit(0)
})

process.once('SIGTERM', () => {
  cleanupSessions()
  process.exit(0)
})

process.once('disconnect', () => {
  cleanupSessions()
  process.exit(0)
})

process.once('exit', () => {
  cleanupSessions()
})

const send = (message: PtyHostMessage): void => {
  try {
    parentPort.postMessage(message)
  } catch {
    // ignore (parentPort disconnected during shutdown)
  }
}

const respondSpawnOk = (requestId: string, sessionId: string): void => {
  send({
    type: 'response',
    requestType: 'spawn',
    hostInstanceId,
    requestId,
    ok: true,
    result: { sessionId },
  })
}

const respondError = (requestType: 'spawn' | 'resize', requestId: string, error: unknown): void => {
  const name = error instanceof Error ? error.name : undefined
  const message = error instanceof Error ? error.message : 'unknown error'
  send({
    type: 'response',
    requestType,
    hostInstanceId,
    requestId,
    ok: false,
    error: { ...(name ? { name } : {}), message },
  })
}

const observeForeground = (
  sessionId: string,
  observedAtMs: number,
  windowsExitCode: number | null,
): void => {
  const rootPid = sessions.get(sessionId)?.rootPid
  if (process.platform === 'win32') {
    const common = {
      type: 'foreground' as const,
      hostInstanceId,
      sessionId,
      observedAtMs,
      availability: 'unavailable' as const,
      agent: null,
      shellOnly: false as const,
    }
    send(
      windowsExitCode === null
        ? { ...common, source: 'windows_prompt_timeout', exitCode: null }
        : { ...common, source: 'windows_exit_code', exitCode: windowsExitCode },
    )
    return
  }
  if (!rootPid) {
    send({
      type: 'foreground',
      hostInstanceId,
      sessionId,
      observedAtMs,
      source: 'process_scan',
      exitCode: null,
      availability: 'unavailable',
      agent: null,
      shellOnly: false,
    })
    return
  }
  const result = spawnSync('ps', ['ax', '-o', 'pid=,ppid=,stat=,command='], {
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    send({
      type: 'foreground',
      hostInstanceId,
      sessionId,
      observedAtMs,
      source: 'process_scan',
      exitCode: null,
      availability: 'unavailable',
      agent: null,
      shellOnly: false,
    })
    return
  }
  send({
    type: 'foreground',
    hostInstanceId,
    sessionId,
    observedAtMs,
    source: 'process_scan',
    exitCode: null,
    ...resolveForegroundAgentObservation(result.stdout, rootPid),
  })
}

const scheduleForegroundObservation = (
  kind: 'marker' | 'probe',
  sessionId: string,
  windowsExitCode: number | null,
): void => {
  const observedAtMs = Date.now()
  const observation = (): void => observeForeground(sessionId, observedAtMs, windowsExitCode)
  if (kind === 'marker') {
    foregroundScheduler.scheduleMarker(sessionId, observation)
  } else {
    foregroundScheduler.scheduleProbe(sessionId, observation)
  }
}

const clearSessionObservationState = (sessionId: string): void => {
  foregroundScheduler.clearSession(sessionId)
  shellIntegrationBuffers.delete(sessionId)
}

const onPtyData = (sessionId: string, data: string): void => {
  send({ type: 'data', hostInstanceId, sessionId, data })
  const bufferedData = `${shellIntegrationBuffers.get(sessionId) ?? ''}${data}`
  const commandFinished = resolveShellCommandFinishedMarker(bufferedData)
  if (!commandFinished) {
    shellIntegrationBuffers.set(sessionId, bufferedData.slice(-64))
    return
  }
  shellIntegrationBuffers.set(sessionId, '')
  scheduleForegroundObservation('marker', sessionId, commandFinished.exitCode)
}

const probeForeground = (sessionId: string): void => {
  if (sessions.has(sessionId)) {
    scheduleForegroundObservation('probe', sessionId, null)
  }
}

const onPtyExit = (sessionId: string, exitCode: number): void => {
  clearSessionObservationState(sessionId)
  const session = sessions.get(sessionId)
  if (session) {
    sessions.delete(sessionId)
    spawnIdentities.release(session.launchId, sessionId)
  }
  send({ type: 'exit', hostInstanceId, sessionId, exitCode })
}

function spawnPtySession(request: PtyHostSpawnRequest): void {
  const existingSessionId = spawnIdentities.findLiveSession(request.launchId, sessionId =>
    sessions.has(sessionId),
  )
  if (existingSessionId) {
    respondSpawnOk(request.requestId, existingSessionId)
    return
  }

  const sessionId = crypto.randomUUID()
  const pty = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    cols: request.cols,
    rows: request.rows,
    name: 'xterm-256color',
  })

  sessions.set(sessionId, {
    pty,
    rootPid: Number.isFinite(pty.pid) && pty.pid > 0 ? pty.pid : null,
    launchId: request.launchId,
  })
  spawnIdentities.bind(request.launchId, sessionId)

  pty.onData(data => {
    onPtyData(sessionId, data)
  })

  pty.onExit(exit => {
    onPtyExit(sessionId, exit.exitCode)
  })

  respondSpawnOk(request.requestId, sessionId)
}

function writeToSession(request: PtyHostWriteRequest): void {
  const pty = sessions.get(request.sessionId)
  if (!pty) {
    return
  }

  if (request.encoding === 'binary') {
    if (process.platform === 'win32') {
      pty.pty.write(convertHighByteX10MouseReportsToSgr(request.data))
    } else {
      pty.pty.write(Buffer.from(request.data, 'binary'))
    }
    return
  }

  pty.pty.write(request.data)
}

function resizeSession(request: PtyHostResizeRequest): void {
  const session = sessions.get(request.sessionId)
  if (!session) {
    throw new Error(`Unknown PTY session: ${request.sessionId}`)
  }

  const resize = resizePtyAndReadAck(session.pty, request.cols, request.rows)
  send({
    type: 'response',
    requestType: 'resize',
    hostInstanceId,
    requestId: request.requestId,
    ok: true,
    result: { sessionId: request.sessionId, resize },
  })
}

function killSession(request: PtyHostKillRequest): void {
  const session = sessions.get(request.sessionId)
  if (!session) {
    return
  }

  sessions.delete(request.sessionId)
  spawnIdentities.release(session.launchId, request.sessionId)
  clearSessionObservationState(request.sessionId)
  terminatePtySession(session)
}

function shutdown(request: PtyHostShutdownRequest): void {
  void request

  cleanupSessions()

  process.exit(0)
}

function crash(request: PtyHostCrashRequest): void {
  void request
  // `process.abort()` can be slow/flaky on Linux CI (core dump generation). We only need a
  // deterministic host termination signal to validate supervisor crash recovery.
  process.exit(1)
}

parentPort.on('message', messageEvent => {
  const raw = messageEvent.data
  if (!isPtyHostRequest(raw, hostInstanceId)) {
    return
  }

  const message = raw

  if (message.type === 'spawn') {
    try {
      spawnPtySession(message)
    } catch (error) {
      respondError('spawn', message.requestId, error)
    }
    return
  }

  if (message.type === 'write') {
    writeToSession(message)
    return
  }

  if (message.type === 'resize') {
    try {
      resizeSession(message)
    } catch (error) {
      respondError('resize', message.requestId, error)
    }
    return
  }

  if (message.type === 'foreground_probe') {
    probeForeground(message.sessionId)
    return
  }

  if (message.type === 'kill') {
    killSession(message)
    return
  }

  if (message.type === 'shutdown') {
    shutdown(message)
    return
  }

  if (message.type === 'crash') {
    crash(message)
    return
  }
})

send({ type: 'ready', protocolVersion: PTY_HOST_PROTOCOL_VERSION, hostInstanceId })
