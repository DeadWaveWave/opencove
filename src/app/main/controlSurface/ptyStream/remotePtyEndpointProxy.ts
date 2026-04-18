import WebSocket from 'ws'
import { createAppError } from '../../../../shared/errors/appError'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  PTY_STREAM_PROTOCOL_VERSION,
  PTY_STREAM_WS_PATH,
  PTY_STREAM_WS_SUBPROTOCOL,
} from './ptyStreamService'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'

type RemoteEndpointConnection = {
  hostname: string
  port: number
  token: string
}

type AttachedSessionState = {
  lastSeq: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.floor(value)
}

function normalizeOptionalRawString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function resolveWsUrl(endpoint: { hostname: string; port: number }): string {
  return `ws://${endpoint.hostname}:${endpoint.port}${PTY_STREAM_WS_PATH}`
}

function trySendWs(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return
  }

  try {
    ws.send(JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export class RemotePtyEndpointProxy {
  private readonly endpointId: string
  private readonly topology: WorkerTopologyStore
  private readonly emitData: (remoteSessionId: string, data: string) => void
  private readonly emitExit: (remoteSessionId: string, exitCode: number) => void
  private readonly attachedSessions = new Map<string, AttachedSessionState>()

  private socket: WebSocket | null = null
  private socketReadyPromise: Promise<void> | null = null
  private socketHandshakePromise: Promise<void> | null = null
  private socketHandshakeResolve: (() => void) | null = null
  private socketHandshakeReject: ((error: Error) => void) | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private disposed = false

  public constructor(options: {
    endpointId: string
    topology: WorkerTopologyStore
    emitData: (remoteSessionId: string, data: string) => void
    emitExit: (remoteSessionId: string, exitCode: number) => void
  }) {
    this.endpointId = options.endpointId
    this.topology = options.topology
    this.emitData = options.emitData
    this.emitExit = options.emitExit
  }

  private closeSocket(): void {
    const current = this.socket
    this.socket = null
    this.socketReadyPromise = null

    if (this.socketHandshakeReject) {
      this.socketHandshakeReject(new Error('PTY stream connection closed'))
    }
    this.socketHandshakePromise = null
    this.socketHandshakeResolve = null
    this.socketHandshakeReject = null

    if (!current) {
      return
    }

    try {
      current.terminate()
    } catch {
      // ignore
    }
  }

  private async resolveEndpointOrThrow(): Promise<RemoteEndpointConnection> {
    const endpoint = await this.topology.resolveRemoteEndpointConnection(this.endpointId)
    if (!endpoint) {
      throw createAppError('worker.unavailable', {
        debugMessage: `Remote endpoint unavailable: ${this.endpointId}`,
      })
    }

    return endpoint
  }

  private handleMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return
    }

    const type = parsed.type

    if (type === 'hello_ack') {
      this.socketHandshakeResolve?.()
      this.socketHandshakeResolve = null
      this.socketHandshakeReject = null
      return
    }

    if (type === 'error') {
      const message = normalizeOptionalRawString(parsed.message) ?? 'PTY error'
      this.socketHandshakeReject?.(new Error(message))
      this.socketHandshakeResolve = null
      this.socketHandshakeReject = null
      return
    }

    const sessionId = normalizeOptionalRawString(parsed.sessionId)
    if (!sessionId) {
      return
    }

    if (type === 'attached') {
      const seq = normalizeOptionalFiniteInt(parsed.seq) ?? 0
      const existing = this.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      } else {
        this.attachedSessions.set(sessionId, { lastSeq: seq })
      }
      return
    }

    if (type === 'data') {
      const data = normalizeOptionalRawString(parsed.data) ?? ''
      const seq = normalizeOptionalFiniteInt(parsed.seq) ?? 0
      const existing = this.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      if (data.length > 0) {
        this.emitData(sessionId, data)
      }
      return
    }

    if (type === 'exit') {
      const exitCode = normalizeOptionalFiniteInt(parsed.exitCode) ?? 0
      const seq = normalizeOptionalFiniteInt(parsed.seq) ?? 0
      const existing = this.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      this.emitExit(sessionId, exitCode)
      return
    }

    if (type === 'overflow') {
      void this.recoverOverflow(sessionId).catch(() => undefined)
    }
  }

  private async recoverOverflow(remoteSessionId: string): Promise<void> {
    const endpoint = await this.resolveEndpointOrThrow()
    const { result } = await invokeControlSurface(endpoint, {
      kind: 'query',
      id: 'session.snapshot',
      payload: { sessionId: remoteSessionId },
    })

    if (!result) {
      throw createAppError('worker.unavailable')
    }

    if (result.ok === false) {
      throw createAppError(result.error)
    }

    const value = result.value as { scrollback?: unknown; toSeq?: unknown }
    const scrollback = typeof value.scrollback === 'string' ? value.scrollback : ''
    const toSeq = normalizeOptionalFiniteInt(value.toSeq) ?? null

    if (toSeq !== null) {
      const state = this.attachedSessions.get(remoteSessionId)
      if (state) {
        state.lastSeq = Math.max(state.lastSeq, toSeq)
      }
    }

    if (scrollback.length > 0) {
      this.emitData(remoteSessionId, scrollback)
    }
  }

  private async connectSocket(): Promise<void> {
    const endpoint = await this.resolveEndpointOrThrow()
    const url = resolveWsUrl(endpoint)

    const ws = new WebSocket(url, PTY_STREAM_WS_SUBPROTOCOL, {
      headers: {
        authorization: `Bearer ${endpoint.token}`,
      },
      perMessageDeflate: false,
    })

    this.socket = ws

    ws.on('message', raw => {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
      if (text.trim().length === 0) {
        return
      }
      this.handleMessage(text)
    })

    ws.once('close', () => {
      this.closeSocket()
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
      }

      if (this.disposed || this.attachedSessions.size === 0) {
        this.reconnectTimer = null
        return
      }

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.ensureSocket().catch(() => undefined)
      }, 500)
    })

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        ws.terminate()
        rejectPromise(new Error('Timed out connecting to PTY stream'))
      }, 3_000)

      ws.once('open', () => {
        clearTimeout(timer)
        resolvePromise()
      })

      ws.once('error', error => {
        clearTimeout(timer)
        rejectPromise(error)
      })
    })

    this.socketHandshakePromise = new Promise<void>((resolvePromise, rejectPromise) => {
      this.socketHandshakeResolve = resolvePromise
      this.socketHandshakeReject = rejectPromise
    })

    trySendWs(ws, {
      type: 'hello',
      protocolVersion: PTY_STREAM_PROTOCOL_VERSION,
      client: {
        kind: 'worker',
        version: null,
      },
    })

    const handshakeTimeout = setTimeout(() => {
      this.socketHandshakeReject?.(new Error('Timed out waiting for PTY hello_ack'))
    }, 3_000)

    try {
      await this.socketHandshakePromise
    } finally {
      clearTimeout(handshakeTimeout)
      this.socketHandshakePromise = null
    }

    for (const [remoteSessionId, state] of this.attachedSessions.entries()) {
      trySendWs(ws, {
        type: 'attach',
        sessionId: remoteSessionId,
        ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
        role: 'controller',
      })
    }
  }

  private async ensureSocket(): Promise<void> {
    if (this.disposed) {
      throw new Error('Remote PTY proxy disposed')
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return
    }

    if (this.socketReadyPromise) {
      return await this.socketReadyPromise
    }

    this.socketReadyPromise = this.connectSocket().catch(error => {
      this.closeSocket()
      throw error
    })

    try {
      await this.socketReadyPromise
    } finally {
      this.socketReadyPromise = null
    }
  }

  public attach(remoteSessionId: string): void {
    const existing = this.attachedSessions.get(remoteSessionId)
    if (!existing) {
      this.attachedSessions.set(remoteSessionId, { lastSeq: 0 })
    }

    void this.ensureSocket()
      .then(() => {
        const ws = this.socket
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return
        }

        const state = this.attachedSessions.get(remoteSessionId) ?? { lastSeq: 0 }
        this.attachedSessions.set(remoteSessionId, state)

        trySendWs(ws, {
          type: 'attach',
          sessionId: remoteSessionId,
          ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
          role: 'controller',
        })
      })
      .catch(() => undefined)
  }

  public forget(remoteSessionId: string): void {
    this.attachedSessions.delete(remoteSessionId)
  }

  public write(remoteSessionId: string, data: string): void {
    void this.ensureSocket()
      .then(() => {
        const ws = this.socket
        if (!ws) {
          return
        }
        trySendWs(ws, { type: 'write', sessionId: remoteSessionId, data })
      })
      .catch(() => undefined)
  }

  public resize(remoteSessionId: string, cols: number, rows: number): void {
    void this.ensureSocket()
      .then(() => {
        const ws = this.socket
        if (!ws) {
          return
        }
        trySendWs(ws, { type: 'resize', sessionId: remoteSessionId, cols, rows })
      })
      .catch(() => undefined)
  }

  public kill(remoteSessionId: string): void {
    void (async () => {
      const endpoint = await this.resolveEndpointOrThrow()
      const { result } = await invokeControlSurface(endpoint, {
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId: remoteSessionId },
      })

      if (!result) {
        throw createAppError('worker.unavailable')
      }

      if (result.ok === false) {
        throw createAppError(result.error)
      }
    })().catch(() => undefined)
  }

  public dispose(): void {
    this.disposed = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    try {
      this.socket?.close()
    } catch {
      // ignore
    }
    this.closeSocket()
    this.attachedSessions.clear()
  }
}
