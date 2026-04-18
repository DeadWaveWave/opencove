import type { IncomingMessage } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Duplex } from 'node:stream'
import type { WebSessionManager } from '../http/webSessionManager'
import { resolveRequestAuth } from '../http/requestAuth'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { PtyStreamHub } from './ptyStreamHub'
import type { PtyStreamClientKind } from './ptyStreamTypes'

export const PTY_STREAM_PROTOCOL_VERSION = 1 as const
export const PTY_STREAM_WS_PATH = '/pty'
export const PTY_STREAM_WS_SUBPROTOCOL = 'opencove-pty.v1'

type PtyStreamClientState = {
  clientId: string
  kind: PtyStreamClientKind | null
  didHandshake: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePtyWriteData(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value !== 'string') {
    return ''
  }

  return value
}

function normalizeSessionId(value: unknown): string | null {
  const sessionId = normalizeOptionalString(value)
  return sessionId
}

function normalizeAfterSeq(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.floor(value)
}

function normalizeRole(value: unknown): 'viewer' | 'controller' | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value === 'viewer' || value === 'controller') {
    return value
  }

  return null
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const intValue = Math.floor(value)
  return intValue > 0 ? intValue : null
}

function resolveOfferedSubprotocols(header: IncomingMessage['headers'][string]): string[] {
  const rawValues: string[] = []

  if (typeof header === 'string') {
    rawValues.push(header)
  } else if (Array.isArray(header)) {
    rawValues.push(...header)
  }

  return rawValues
    .flatMap(value =>
      value
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0),
    )
    .filter((value, index, list) => list.indexOf(value) === index)
}

export interface PtyStreamService {
  hub: PtyStreamHub
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  dispose: () => void
}

export function createPtyStreamService(options: {
  token: string
  webSessions: WebSessionManager
  now: () => Date
  ptyRuntime: ControlSurfacePtyRuntime
  replayWindowMaxBytes: number
  allowQueryToken?: boolean
}): PtyStreamService {
  const allowQueryToken = options.allowQueryToken === true
  const hub = new PtyStreamHub({
    ptyRuntime: options.ptyRuntime,
    replayWindowMaxBytes: options.replayWindowMaxBytes,
  })

  const disposeDataListener = options.ptyRuntime.onData(({ sessionId, data }) => {
    hub.handlePtyData(sessionId, data)
  })

  const disposeExitListener = options.ptyRuntime.onExit(({ sessionId, exitCode }) => {
    hub.handlePtyExit(sessionId, exitCode)
  })

  const instanceId = randomBytes(18).toString('base64url')
  const clients = new Set<WebSocket>()
  const stateBySocket = new WeakMap<WebSocket, PtyStreamClientState>()

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    handleProtocols: protocols => {
      return protocols.has(PTY_STREAM_WS_SUBPROTOCOL) ? PTY_STREAM_WS_SUBPROTOCOL : false
    },
  })

  const closeWithError = (ws: WebSocket, code: string, message: string): void => {
    try {
      ws.send(JSON.stringify({ type: 'error', code, message }))
    } catch {
      // ignore
    }

    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  wss.on('connection', ws => {
    const state = stateBySocket.get(ws)
    if (!state) {
      ws.close()
      return
    }

    clients.add(ws)

    ws.once('close', () => {
      clients.delete(ws)
      hub.unregisterClient(state.clientId)
    })

    const handshakeTimer = setTimeout(() => {
      closeWithError(ws, 'protocol.missing_hello', 'Missing hello message.')
    }, 2_000)

    ws.on('message', raw => {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
      if (text.trim().length === 0) {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        closeWithError(ws, 'protocol.invalid_json', 'Invalid JSON message.')
        return
      }

      if (!isRecord(parsed)) {
        closeWithError(ws, 'protocol.invalid_message', 'Invalid message.')
        return
      }

      const message = parsed
      const type = message.type

      if (!state.didHandshake) {
        if (type !== 'hello') {
          closeWithError(ws, 'protocol.expected_hello', 'Expected hello message.')
          return
        }

        const protocolVersion = message.protocolVersion
        if (protocolVersion !== PTY_STREAM_PROTOCOL_VERSION) {
          closeWithError(ws, 'protocol.version_mismatch', 'Unsupported protocol version.')
          return
        }

        const client = message.client
        const clientKind =
          client && typeof client === 'object' && !Array.isArray(client)
            ? (client as Record<string, unknown>).kind
            : null

        state.kind =
          clientKind === 'web' || clientKind === 'desktop' || clientKind === 'cli'
            ? clientKind
            : 'unknown'
        state.didHandshake = true
        clearTimeout(handshakeTimer)

        hub.registerClient({
          clientId: state.clientId,
          kind: state.kind,
          ws,
        })

        try {
          ws.send(
            JSON.stringify({
              type: 'hello_ack',
              protocolVersion: PTY_STREAM_PROTOCOL_VERSION,
              server: {
                instanceId,
              },
              capabilities: {
                roles: ['viewer', 'controller'],
                replayWindow: { maxBytes: options.replayWindowMaxBytes },
              },
            }),
          )
        } catch {
          // ignore
        }

        return
      }

      if (typeof type !== 'string') {
        closeWithError(ws, 'protocol.invalid_message', 'Invalid message.')
        return
      }

      if (type === 'attach') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.attach({
          clientId: state.clientId,
          sessionId,
          afterSeq: normalizeAfterSeq(message.afterSeq),
          role: normalizeRole(message.role),
        })
        return
      }

      if (type === 'detach') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.detach(state.clientId, sessionId)
        return
      }

      if (type === 'request_control') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.requestControl({ clientId: state.clientId, sessionId })
        return
      }

      if (type === 'release_control') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.releaseControl({ clientId: state.clientId, sessionId })
        return
      }

      if (type === 'write') {
        const sessionId = normalizeSessionId(message.sessionId)
        const data = normalizePtyWriteData(message.data)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.write({ clientId: state.clientId, sessionId, data })
        return
      }

      if (type === 'resize') {
        const sessionId = normalizeSessionId(message.sessionId)
        const cols = normalizePositiveInt(message.cols)
        const rows = normalizePositiveInt(message.rows)

        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        if (!cols || !rows) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing cols/rows.')
          return
        }

        hub.resize({ clientId: state.clientId, sessionId, cols, rows })
        return
      }

      closeWithError(ws, 'protocol.unknown_message', `Unsupported message type: ${type}`)
    })
  })

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!req.url) {
      socket.destroy()
      return
    }

    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== PTY_STREAM_WS_PATH) {
      socket.destroy()
      return
    }

    const offeredProtocols = resolveOfferedSubprotocols(req.headers['sec-websocket-protocol'])
    if (!offeredProtocols.includes(PTY_STREAM_WS_SUBPROTOCOL)) {
      try {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {
        // ignore
      }
      socket.destroy()
      return
    }

    const auth = resolveRequestAuth({
      req,
      url,
      token: options.token,
      webSessions: options.webSessions,
      allowQueryToken,
      now: options.now(),
    })

    if (!auth) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      } catch {
        // ignore
      }
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      stateBySocket.set(ws, {
        clientId: randomBytes(12).toString('base64url'),
        kind: null,
        didHandshake: false,
      })

      wss.emit('connection', ws, req)
    })
  }

  return {
    hub,
    handleUpgrade,
    dispose: () => {
      clients.forEach(client => {
        try {
          client.close()
        } catch {
          // ignore
        }
      })
      clients.clear()

      try {
        wss.close()
      } catch {
        // ignore
      }

      disposeDataListener()
      disposeExitListener()
    },
  }
}
