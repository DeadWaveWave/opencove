import { spawnSync } from 'node:child_process'
import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
import { parentPort as workerParentPort } from 'node:worker_threads'
import { killWindowsProcessTree } from './windowsProcessTree'
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

type ParentPort = {
  on: (event: 'message', listener: (messageEvent: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
  start: () => void
}

type ChildProcessPort = {
  on: (event: 'message', listener: (message: unknown) => void) => void
  send?: (message: unknown) => void
}

function isProcessAlive(pid: number): boolean {
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

function cleanupOrphanedNodePtySpawnHelpers(): void {
  if (process.platform === 'win32') {
    return
  }

  const spawnHelperMarker = '/node-pty/build/Release/spawn-helper'

  const psResult = spawnSync('ps', ['ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    env: process.env,
  })

  if (psResult.status !== 0 || typeof psResult.stdout !== 'string') {
    return
  }

  const candidates: number[] = []
  for (const line of psResult.stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) {
      continue
    }

    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3] ?? ''

    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) {
      continue
    }

    if (ppid !== 1) {
      continue
    }

    const normalizedCommand = command.replaceAll('\\', '/')
    if (!normalizedCommand.includes(spawnHelperMarker)) {
      continue
    }

    candidates.push(pid)
  }

  if (candidates.length === 0) {
    return
  }

  for (const pid of candidates) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }

  for (const pid of candidates) {
    if (!isProcessAlive(pid)) {
      continue
    }

    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // ignore
    }
  }
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

type PtySession = {
  pty: IPty
  rootPid: number | null
}

const sessions = new Map<string, PtySession>()
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
    terminatePtySession(session)
  }
}

cleanupOrphanedNodePtySpawnHelpers()

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

const respondOk = (requestId: string, sessionId: string): void => {
  send({ type: 'response', requestId, ok: true, result: { sessionId } })
}

const respondError = (requestId: string, error: unknown): void => {
  const name = error instanceof Error ? error.name : undefined
  const message = error instanceof Error ? error.message : 'unknown error'
  send({ type: 'response', requestId, ok: false, error: { name, message } })
}

const onPtyData = (sessionId: string, data: string): void => {
  send({ type: 'data', sessionId, data })
}

const onPtyExit = (sessionId: string, exitCode: number): void => {
  sessions.delete(sessionId)
  send({ type: 'exit', sessionId, exitCode })
}

function spawnPtySession(request: PtyHostSpawnRequest): void {
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
  })

  pty.onData(data => {
    onPtyData(sessionId, data)
  })

  pty.onExit(exit => {
    onPtyExit(sessionId, exit.exitCode)
  })

  respondOk(request.requestId, sessionId)
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
    return
  }

  session.pty.resize(request.cols, request.rows)
}

function killSession(request: PtyHostKillRequest): void {
  const session = sessions.get(request.sessionId)
  if (!session) {
    return
  }

  sessions.delete(request.sessionId)
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
  if (!isPtyHostRequest(raw)) {
    return
  }

  const message = raw

  if (message.type === 'spawn') {
    try {
      spawnPtySession(message)
    } catch (error) {
      respondError(message.requestId, error)
    }
    return
  }

  if (message.type === 'write') {
    writeToSession(message)
    return
  }

  if (message.type === 'resize') {
    resizeSession(message)
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

send({ type: 'ready', protocolVersion: PTY_HOST_PROTOCOL_VERSION })
