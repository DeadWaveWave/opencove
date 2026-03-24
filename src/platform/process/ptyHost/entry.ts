import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
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

function resolveParentPort(): ParentPort {
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!parentPort) {
    throw new Error('[pty-host] missing process.parentPort')
  }

  return parentPort
}

const parentPort = resolveParentPort()
parentPort.start()
const sessions = new Map<string, IPty>()

const send = (message: PtyHostMessage): void => {
  parentPort.postMessage(message)
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

  sessions.set(sessionId, pty)

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
      pty.write(convertHighByteX10MouseReportsToSgr(request.data))
    } else {
      pty.write(Buffer.from(request.data, 'binary'))
    }
    return
  }

  pty.write(request.data)
}

function resizeSession(request: PtyHostResizeRequest): void {
  const pty = sessions.get(request.sessionId)
  if (!pty) {
    return
  }

  pty.resize(request.cols, request.rows)
}

function killSession(request: PtyHostKillRequest): void {
  const pty = sessions.get(request.sessionId)
  if (!pty) {
    return
  }

  sessions.delete(request.sessionId)
  pty.kill()
}

function shutdown(request: PtyHostShutdownRequest): void {
  void request

  for (const [sessionId, pty] of sessions.entries()) {
    sessions.delete(sessionId)
    try {
      pty.kill()
    } catch {
      // ignore
    }
  }

  process.exit(0)
}

function crash(request: PtyHostCrashRequest): void {
  void request
  process.abort()
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
