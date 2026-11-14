import { terminalEnvironment } from '../../../shared/runtime/terminalEnvironment.mjs'
import { assertSpawnEnvironment } from '../spawnEnvironment'
import { preparePtySpawnArguments } from '../spawnArguments'
import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
import { resolvePtyHostParentPort } from './parentPort'
import { createPtyHostShutdown } from './shutdown'
import { AgentProcessReaper, type PtySessionKind } from './agentProcessReaper'
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
import { observePtyForeground } from './foregroundObservation'
import { resolveShellCommandFinishedMarker } from '../../../shared/terminal/shellIntegration'
import { PtyHostForegroundObservationScheduler } from './foregroundObservationScheduler'
import { WindowsConsoleGeometryObserver } from './windowsConsoleObserver'
import { WindowsPtyResizeOwner } from './windowsPtyResizeOwner'

const parentPort = resolvePtyHostParentPort()
parentPort.start()
const hostInstanceId = crypto.randomUUID()

type PtySession = {
  pty: IPty
  rootPid: number | null
  launchId: string
  kind: PtySessionKind
  exited: boolean
  resizeOwner: WindowsPtyResizeOwner | null
}

const sessions = new Map<string, PtySession>()
const foregroundScheduler = new PtyHostForegroundObservationScheduler()
const shellIntegrationBuffers = new Map<string, string>()
const spawnIdentities = new PtyHostSpawnIdentityRegistry()
const consoleObserver = process.platform === 'win32' ? new WindowsConsoleGeometryObserver() : null
const reaper = new AgentProcessReaper()
let hasCleanedSessions = false

function terminatePtySession(sessionId: string, session: PtySession): void {
  session.resizeOwner?.dispose()
  if (session.kind === 'agent' && process.platform !== 'win32') {
    void reaper.terminate(sessionId, session.exited ? undefined : () => session.pty.kill())
    return
  }
  if (session.exited) {
    return
  }
  const killResult = killWindowsProcessTree(session.rootPid)
  if (killResult === 'terminated' || killResult === 'not_found') {
    return
  }

  try {
    session.pty.kill()
  } catch (error) {
    process.stderr.write(`[pty-host] PTY hangup failed: ${String(error)}\n`)
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
    terminatePtySession(sessionId, session)
  }
  foregroundScheduler.dispose()
  consoleObserver?.dispose()
  shellIntegrationBuffers.clear()
  spawnIdentities.clear()
}

ensureNodePtySpawnHelperExecutable()

const shutdownHost = createPtyHostShutdown({
  cleanup: cleanupSessions,
  drain: () => reaper.drain(),
})
for (const signal of ['SIGINT', 'SIGTERM', 'disconnect'] as const) {
  process.once(signal, () => {
    void shutdownHost()
  })
}
parentPort.on('close', () => {
  void shutdownHost()
})
// Abrupt process.exit cannot await reapers; clean shutdown always uses shutdownHost.
process.once('exit', cleanupSessions)

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

const scheduleForegroundObservation = (
  kind: 'marker' | 'probe',
  sessionId: string,
  windowsExitCode: number | null,
): void => {
  const observedAtMs = Date.now()
  const observation = (): void => {
    void observePtyForeground({
      sessionId,
      observedAtMs,
      windowsExitCode,
      hostInstanceId,
      rootPid: sessions.get(sessionId)?.rootPid ?? null,
      platform: process.platform,
      readTable: () => reaper.readTable(),
      send,
      isCurrent: () => sessions.get(sessionId)?.exited === false,
    })
  }
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
    session.resizeOwner?.dispose()
    session.exited = true
    reaper.noteExit(sessionId)
    if (session.kind !== 'agent') {
      sessions.delete(sessionId)
    }
    spawnIdentities.release(session.launchId, sessionId)
  }
  send({ type: 'exit', hostInstanceId, sessionId, exitCode })
}

function spawnPtySession(request: PtyHostSpawnRequest): void {
  if (hasCleanedSessions) {
    throw new Error('[pty-host] shutting down')
  }
  const existingSessionId = spawnIdentities.findLiveSession(
    request.launchId,
    sessionId => sessions.get(sessionId)?.exited === false,
  )
  if (existingSessionId) {
    respondSpawnOk(request.requestId, existingSessionId)
    return
  }

  const sessionId = crypto.randomUUID()
  assertSpawnEnvironment(request.env ?? {})
  const pty = spawn(
    request.command,
    preparePtySpawnArguments(request.command, request.args, request.cwd),
    {
      cwd: request.cwd,
      env: {
        ...request.env,
        ...(request.env?.OPENCOVE_ENV === '1'
          ? { [terminalEnvironment.sessionId]: sessionId }
          : {}),
      },
      cols: request.cols,
      rows: request.rows,
      name: 'xterm-256color',
    },
  )

  sessions.set(sessionId, {
    pty,
    rootPid: Number.isFinite(pty.pid) && pty.pid > 0 ? pty.pid : null,
    launchId: request.launchId,
    kind: request.sessionKind,
    exited: false,
    resizeOwner: consoleObserver ? new WindowsPtyResizeOwner(pty, consoleObserver) : null,
  })
  if (request.sessionKind === 'agent' && pty.pid > 0) {
    void reaper.track(sessionId, pty.pid)
  }
  spawnIdentities.bind(request.launchId, sessionId)

  pty.onData(data => {
    // node-pty sets its Windows ready flag within this native data dispatch. The promise
    // continuation runs after that dispatch, so resize never enters its deferred startup queue.
    sessions.get(sessionId)?.resizeOwner?.markReady()
    onPtyData(sessionId, data)
  })

  pty.onExit(exit => {
    onPtyExit(sessionId, exit.exitCode)
  })

  respondSpawnOk(request.requestId, sessionId)
}

function writeToSession(request: PtyHostWriteRequest): void {
  const pty = sessions.get(request.sessionId)
  if (!pty || pty.exited) {
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

async function resizeSession(request: PtyHostResizeRequest): Promise<void> {
  const session = sessions.get(request.sessionId)
  if (!session || session.exited) {
    throw new Error(`Unknown PTY session: ${request.sessionId}`)
  }

  const resize = session.resizeOwner
    ? await session.resizeOwner.resize(request.cols, request.rows)
    : resizePtyAndReadAck(session.pty, request.cols, request.rows)
  if (sessions.get(request.sessionId) !== session) {
    throw new Error(`PTY session closed during resize: ${request.sessionId}`)
  }
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
  terminatePtySession(request.sessionId, session)
}

function shutdown(request: PtyHostShutdownRequest): void {
  void request

  void shutdownHost()
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
    void resizeSession(message).catch(error => {
      respondError('resize', message.requestId, error)
    })
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
