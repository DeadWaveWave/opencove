import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket, WebSocketServer } from 'ws'
import { resolveRequestAuth, type RequestAuth } from '../http/requestAuth'
import type { WebSessionManager } from '../http/webSessionManager'
import type {
  ControlSurfaceHttpListenerRole,
  ControlSurfacePtyClientCloseFilter,
} from '../controlSurfaceHttpRuntime.contract'
import type { PtyStreamClientKind } from './ptyStreamTypes'
import { resolveOfferedPtyStreamSubprotocols } from './ptyStreamMessageValidation'

export type PtyStreamClientState = {
  clientId: string
  kind: PtyStreamClientKind | null
  didHandshake: boolean
  auth: RequestAuth
  listenerRole: ControlSurfaceHttpListenerRole
  webAccessGeneration: number | null
  remoteAddress: string | null
}

export interface PtyStreamUpgradeContext {
  listenerRole: ControlSurfaceHttpListenerRole
  webAccessGeneration?: number | null
}

function rejectUpgrade(socket: Duplex, statusLine?: string): void {
  if (statusLine) {
    try {
      socket.write(`${statusLine}\r\n\r\n`)
    } catch {
      // ignore
    }
  }
  socket.destroy()
}

export function handlePtyStreamUpgrade(input: {
  req: IncomingMessage
  socket: Duplex
  head: Buffer
  context: PtyStreamUpgradeContext
  ingressFrozen: boolean
  token: string
  webSessions: WebSessionManager
  allowQueryToken: boolean
  now: () => Date
  path: string
  subprotocol: string
  wss: WebSocketServer
  stateBySocket: WeakMap<WebSocket, PtyStreamClientState>
}): void {
  if (input.ingressFrozen || !input.req.url) {
    rejectUpgrade(input.socket)
    return
  }
  const url = new URL(input.req.url, 'http://localhost')
  if (url.pathname !== input.path) {
    rejectUpgrade(input.socket)
    return
  }
  const protocols = resolveOfferedPtyStreamSubprotocols(input.req.headers['sec-websocket-protocol'])
  if (!protocols.includes(input.subprotocol)) {
    rejectUpgrade(input.socket, 'HTTP/1.1 400 Bad Request')
    return
  }

  const auth = resolveRequestAuth({
    req: input.req,
    url,
    token: input.token,
    webSessions: input.webSessions,
    allowQueryToken: input.allowQueryToken,
    now: input.now(),
  })
  if (
    !auth ||
    (input.context.listenerRole === 'private' &&
      auth.kind !== 'bearer' &&
      auth.kind !== 'query_token')
  ) {
    rejectUpgrade(input.socket, 'HTTP/1.1 401 Unauthorized')
    return
  }

  input.wss.handleUpgrade(input.req, input.socket, input.head, ws => {
    input.stateBySocket.set(ws, {
      clientId: randomBytes(12).toString('base64url'),
      kind: null,
      didHandshake: false,
      auth,
      listenerRole: input.context.listenerRole,
      webAccessGeneration: input.context.webAccessGeneration ?? null,
      remoteAddress: input.req.socket.remoteAddress ?? null,
    })
    input.wss.emit('connection', ws, input.req)
  })
}

function isLoopbackAddress(value: string | null): boolean {
  if (!value) {
    return false
  }
  const normalized = value.toLowerCase()
  return (
    normalized === '::1' || normalized.startsWith('127.') || normalized.startsWith('::ffff:127.')
  )
}

function matchesCloseFilter(
  state: PtyStreamClientState,
  filter: ControlSurfacePtyClientCloseFilter,
): boolean {
  if (filter.listenerRole && state.listenerRole !== filter.listenerRole) {
    return false
  }
  if (
    filter.webAccessGeneration !== undefined &&
    state.webAccessGeneration !== filter.webAccessGeneration
  ) {
    return false
  }
  if (
    filter.webSessionGeneration !== undefined &&
    (state.auth.kind !== 'cookie' ||
      state.auth.webSessionGeneration !== filter.webSessionGeneration)
  ) {
    return false
  }
  return !(filter.nonLoopbackOnly === true && isLoopbackAddress(state.remoteAddress))
}

export function closePtyStreamClients(input: {
  clients: Set<WebSocket>
  stateBySocket: WeakMap<WebSocket, PtyStreamClientState>
  filter: ControlSurfacePtyClientCloseFilter
}): number {
  let closedCount = 0
  for (const client of input.clients) {
    const state = input.stateBySocket.get(client)
    if (!state || !matchesCloseFilter(state, input.filter)) {
      continue
    }
    closedCount += 1
    try {
      client.close()
    } catch {
      // ignore
    }
  }
  return closedCount
}
