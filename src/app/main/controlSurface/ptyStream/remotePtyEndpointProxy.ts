import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { createAppError } from '../../../../shared/errors/appError'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { PTY_STREAM_PROTOCOL_VERSION, PTY_STREAM_WS_SUBPROTOCOL } from './ptyStreamService'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type {
  ListSessionsResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import { createRemoteGeometryAckCoordinator } from '../remote/remoteGeometryAckCoordinator'
import {
  createRemotePtyEndpointAttachedSessionState,
  createRemotePtyEndpointProxyMessageHandler,
  type RemotePtyEndpointAttachedSessionState,
} from './remotePtyEndpointProxy.messageHandler'
import {
  createRemotePtyOverflowRecoveryCoordinator,
  type RemotePtyOverflowRecoveryCoordinator,
} from './remotePtyEndpointProxy.overflowRecovery'
import { fetchRemotePtyPresentationSnapshot } from './remotePtyEndpointProxy.snapshotQuery'
import {
  normalizeOptionalFiniteInt,
  resolveRemotePtyWsUrl,
  trySendRemotePtyWs,
} from './remotePtyEndpointProxy.support'

type RemoteEndpointConnection = {
  hostname: string
  port: number
  token: string
}

export class RemotePtyEndpointProxy {
  private readonly endpointId: string
  private readonly topology: WorkerTopologyStore
  private readonly emitData: (remoteSessionId: string, data: string) => void
  private readonly emitExit: (remoteSessionId: string, exitCode: number) => void
  private readonly emitState: (
    remoteSessionId: string,
    state: TerminalSessionStateEvent['state'],
  ) => void
  private readonly emitMetadata: (
    remoteSessionId: string,
    metadata: TerminalSessionMetadataEvent,
  ) => void
  private readonly emitPresentationReset: (
    remoteSessionId: string,
    snapshot: PresentationSnapshotTerminalResult,
  ) => Promise<void>
  private readonly emitPresentationResetCommitted: (
    remoteSessionId: string,
    committed: boolean,
  ) => void
  private readonly attachedSessions = new Map<string, RemotePtyEndpointAttachedSessionState>()
  private readonly overflowRecovery: RemotePtyOverflowRecoveryCoordinator
  private readonly geometryAcks = createRemoteGeometryAckCoordinator()
  private readonly messageHandler: (raw: string) => void

  private socket: WebSocket | null = null
  private socketReadyPromise: Promise<void> | null = null
  private socketHandshakePromise: Promise<void> | null = null
  private socketHandshakeResolve: (() => void) | null = null
  private socketHandshakeReject: ((error: Error) => void) | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private disposed = false
  private presentationRecoveryStopping = false
  private presentationRecoveryDrainPromise: Promise<void> | null = null
  private geometryCommitAckSupported: boolean | null = null
  private serverInstanceId: string | null = null

  public constructor(options: {
    endpointId: string
    topology: WorkerTopologyStore
    emitData: (remoteSessionId: string, data: string) => void
    emitExit: (remoteSessionId: string, exitCode: number) => void
    emitState: (remoteSessionId: string, state: TerminalSessionStateEvent['state']) => void
    emitMetadata: (remoteSessionId: string, metadata: TerminalSessionMetadataEvent) => void
    emitPresentationReset: (
      remoteSessionId: string,
      snapshot: PresentationSnapshotTerminalResult,
    ) => Promise<void>
    emitPresentationResetCommitted: (remoteSessionId: string, committed: boolean) => void
  }) {
    this.endpointId = options.endpointId
    this.topology = options.topology
    this.emitData = options.emitData
    this.emitExit = options.emitExit
    this.emitState = options.emitState
    this.emitMetadata = options.emitMetadata
    this.emitPresentationReset = options.emitPresentationReset
    this.emitPresentationResetCommitted = options.emitPresentationResetCommitted
    this.overflowRecovery = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions: this.attachedSessions,
      fetchPresentationSnapshot: remoteSessionId => this.presentationSnapshot(remoteSessionId),
      applyPresentationReset: (remoteSessionId, snapshot) =>
        this.emitPresentationReset(remoteSessionId, snapshot),
      onPresentationResetSettled: (remoteSessionId, committed) =>
        this.emitPresentationResetCommitted(remoteSessionId, committed),
      emitData: (remoteSessionId, data) => this.emitData(remoteSessionId, data),
      emitExit: (remoteSessionId, exitCode) => this.emitExit(remoteSessionId, exitCode),
      reconnectFromLastAppliedCursor: () => this.closeSocket(),
    })
    this.messageHandler = createRemotePtyEndpointProxyMessageHandler({
      attachedSessions: this.attachedSessions,
      onHelloAck: ({ geometryCommitAckSupported, serverInstanceId }) => {
        this.geometryCommitAckSupported = geometryCommitAckSupported
        this.serverInstanceId = serverInstanceId
        this.socketHandshakeResolve?.()
        this.socketHandshakeResolve = null
        this.socketHandshakeReject = null
      },
      onError: ({ sessionId, message }) => {
        if (sessionId && this.geometryCommitAckSupported !== true) {
          this.geometryAcks.rejectSession(sessionId, new Error(message))
          return
        }
        this.socketHandshakeReject?.(new Error(message))
        this.socketHandshakeResolve = null
        this.socketHandshakeReject = null
      },
      onResizeResult: result => {
        this.geometryAcks.resolveResult(result)
      },
      onData: (sessionId, data, seq) => this.overflowRecovery.handleData(sessionId, data, seq),
      onExit: (sessionId, exitCode, seq) =>
        this.overflowRecovery.handleExit(sessionId, exitCode, seq),
      onOverflow: sessionId => {
        this.overflowRecovery.begin(sessionId)
      },
      onState: (sessionId, state) => this.emitState(sessionId, state),
      onMetadata: (sessionId, metadata) => this.emitMetadata(sessionId, metadata),
    })
  }

  private closeSocket(): void {
    const current = this.socket
    this.socket = null
    this.socketReadyPromise = null
    this.serverInstanceId = null
    this.geometryAcks.rejectAll(new Error('PTY stream connection closed'))
    this.attachedSessions.forEach(state => {
      state.authorityEpoch = null
    })

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
    this.messageHandler(raw)
  }

  private async connectSocket(): Promise<void> {
    const endpoint = await this.resolveEndpointOrThrow()
    const url = resolveRemotePtyWsUrl(endpoint)

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

      if (this.disposed || this.presentationRecoveryStopping || this.attachedSessions.size === 0) {
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

    trySendRemotePtyWs(ws, {
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
      trySendRemotePtyWs(ws, {
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
    if (this.presentationRecoveryStopping) {
      throw new Error('Remote PTY proxy presentation recovery is stopping')
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

  public prepareAttach(remoteSessionId: string, afterSeq?: number | null): void {
    const replayCursor = Math.max(0, normalizeOptionalFiniteInt(afterSeq) ?? 0)
    const existing = this.attachedSessions.get(remoteSessionId)
    if (!existing) {
      const created = createRemotePtyEndpointAttachedSessionState()
      created.lastSeq = replayCursor
      this.attachedSessions.set(remoteSessionId, created)
    } else {
      existing.lastSeq = Math.max(existing.lastSeq, replayCursor)
    }
  }

  public attach(remoteSessionId: string, afterSeq?: number | null): void {
    this.prepareAttach(remoteSessionId, afterSeq)

    void this.ensureSocket()
      .then(() => {
        const ws = this.socket
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return
        }

        const state =
          this.attachedSessions.get(remoteSessionId) ??
          createRemotePtyEndpointAttachedSessionState()
        this.attachedSessions.set(remoteSessionId, state)

        trySendRemotePtyWs(ws, {
          type: 'attach',
          sessionId: remoteSessionId,
          ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
          role: 'controller',
        })
      })
      .catch(() => undefined)
  }

  /** Sequence already applied by the downstream consumer for this Remote Hub session. */
  public getReplayCursor(remoteSessionId: string): number | null {
    return this.attachedSessions.get(remoteSessionId)?.lastSeq ?? null
  }

  public async findSession(
    remoteSessionId: string,
    expectedServerInstanceId?: string | null,
  ): Promise<ListSessionsResult['sessions'][number] | null> {
    await this.ensureSocket()
    if (expectedServerInstanceId && this.serverInstanceId !== expectedServerInstanceId) {
      return null
    }
    const endpoint = await this.resolveEndpointOrThrow()
    const { result } = await invokeControlSurface(endpoint, {
      kind: 'query',
      id: 'session.list',
      payload: null,
    })
    if (!result) {
      throw createAppError('worker.unavailable')
    }
    if (result.ok === false) {
      throw createAppError(result.error)
    }

    const value = result.value as Partial<ListSessionsResult> | null
    if (!Array.isArray(value?.sessions)) {
      throw new Error('Invalid session.list response payload')
    }
    return value.sessions.find(session => session?.sessionId === remoteSessionId) ?? null
  }

  public async presentationSnapshot(
    remoteSessionId: string,
  ): Promise<PresentationSnapshotTerminalResult> {
    return await fetchRemotePtyPresentationSnapshot({
      endpoint: await this.resolveEndpointOrThrow(),
      remoteSessionId,
    })
  }

  public async resolveServerInstanceId(): Promise<string | null> {
    await this.ensureSocket()
    return this.serverInstanceId
  }

  /** Freezes the remote stream and drains overflow recovery from fetch through reset settlement. */
  public async drainPresentationRecovery(): Promise<void> {
    if (!this.presentationRecoveryDrainPromise) {
      this.presentationRecoveryStopping = true
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.presentationRecoveryDrainPromise = this.overflowRecovery.drainAndStopAccepting()
      this.closeSocket()
    }
    await this.presentationRecoveryDrainPromise
  }

  public forget(remoteSessionId: string): void {
    this.overflowRecovery.forget(remoteSessionId)
    this.attachedSessions.delete(remoteSessionId)
  }

  public write(remoteSessionId: string, data: string): void {
    void this.ensureSocket()
      .then(() => {
        const ws = this.socket
        if (!ws) {
          return
        }
        trySendRemotePtyWs(ws, { type: 'write', sessionId: remoteSessionId, data })
      })
      .catch(() => undefined)
  }

  public async resize(input: ResizeTerminalInput): Promise<TerminalGeometryCommitResult> {
    const operationId = input.operationId?.trim() || randomUUID()
    await this.ensureSocket()
    const ws = this.socket
    if (!ws) {
      throw new Error('Remote PTY socket is unavailable')
    }
    const attached = this.attachedSessions.get(input.sessionId)
    const resultPromise = this.geometryAcks.waitForResult({
      sessionId: input.sessionId,
      operationId,
      timeoutMs: 3_000,
      timeoutMessage: `Timed out waiting for remote geometry ACK: ${input.sessionId}`,
    })
    const sent = trySendRemotePtyWs(ws, {
      type: 'resize',
      sessionId: input.sessionId,
      cols: input.cols,
      rows: input.rows,
      reason: input.reason,
      operationId,
      // Upstream revisions/epochs belong to the Home Hub. This proxy owns the downstream attach,
      // so only its Remote Hub authority epoch is valid on this wire.
      ...(typeof attached?.authorityEpoch === 'number'
        ? { authorityEpoch: attached.authorityEpoch }
        : {}),
    })
    if (!sent) {
      this.geometryAcks.rejectOperation(
        input.sessionId,
        operationId,
        new Error('Failed to send remote geometry request'),
      )
    }
    return await resultPromise
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
    this.presentationRecoveryStopping = true

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
    this.geometryAcks.rejectAll(new Error('Remote PTY proxy disposed'))
    this.overflowRecovery.dispose()
    this.attachedSessions.clear()
  }
}
