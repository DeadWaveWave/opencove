import WebSocket from 'ws'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { PTY_STREAM_PROTOCOL_VERSION, PTY_STREAM_WS_SUBPROTOCOL } from './ptyStreamService'
import type {
  ListSessionsResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  TerminalAgentReexecResult,
  TerminalGeometryCommitResult,
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import { createRemoteGeometryAckCoordinator } from '../remote/remoteGeometryAckCoordinator'
import { TerminalAgentReexecResultCoordinator } from '../../../../shared/runtime/terminalAgentReexecResultCoordinator'
import type { TerminalAgentReexecRuntimeInput } from '../handlers/sessionPtyRuntime'
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
  findRemotePtyEndpointSession,
  killRemotePtyEndpointSession,
} from './remotePtyEndpointProxy.sessionQuery'
import { reexecRemotePtyEndpointAgent } from './remotePtyEndpointProxy.agentReexec'
import { resizeRemotePtyEndpoint } from './remotePtyEndpointProxy.resize'
import {
  PtyStreamSocketAttemptFence,
  type PtyStreamSocketAttempt,
} from '../../../../shared/runtime/ptyStreamSocketAttemptFence'
import {
  normalizeOptionalFiniteInt,
  resolveRemotePtyEndpointConnection,
  resolveRemotePtyWsUrl,
  trySendRemotePtyWs,
} from './remotePtyEndpointProxy.support'

export class RemotePtyEndpointProxy {
  private readonly endpointId: string
  private readonly topology: WorkerTopologyStore
  private readonly emitData: (remoteSessionId: string, data: string) => void
  private readonly emitExit: (remoteSessionId: string, exitCode: number) => void
  private readonly emitForeground: (remoteSessionId: string, event: TerminalForegroundEvent) => void
  private readonly emitState: (remoteSessionId: string, event: TerminalSessionStateEvent) => void
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
  private readonly agentReexecAcks = new TerminalAgentReexecResultCoordinator()
  private readonly socketAttempts = new PtyStreamSocketAttemptFence()
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
  private agentReexecSupported: boolean | null = null
  private geometryCommitAckSupported: boolean | null = null
  private serverInstanceId: string | null = null

  public constructor(options: {
    endpointId: string
    topology: WorkerTopologyStore
    emitData: (remoteSessionId: string, data: string) => void
    emitExit: (remoteSessionId: string, exitCode: number) => void
    emitForeground: (remoteSessionId: string, event: TerminalForegroundEvent) => void
    emitState: (remoteSessionId: string, event: TerminalSessionStateEvent) => void
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
    this.emitForeground = options.emitForeground
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
      onHelloAck: ({ agentReexecSupported, geometryCommitAckSupported, serverInstanceId }) => {
        this.agentReexecSupported = agentReexecSupported
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
      onAgentReexecResult: result => {
        this.agentReexecAcks.resolve(result)
      },
      onResizeResult: result => {
        this.geometryAcks.resolveResult(result)
      },
      onData: (sessionId, data, seq) => this.overflowRecovery.handleData(sessionId, data, seq),
      onExit: (sessionId, exitCode, seq) => {
        this.agentReexecAcks.rejectSession(sessionId, new Error('Terminal session exited'))
        this.overflowRecovery.handleExit(sessionId, exitCode, seq)
      },
      onForeground: (sessionId, event) => this.emitForeground(sessionId, event),
      onOverflow: sessionId => {
        this.overflowRecovery.begin(sessionId)
      },
      onState: (sessionId, event) => this.emitState(sessionId, event),
      onMetadata: (sessionId, metadata) => this.emitMetadata(sessionId, metadata),
    })
  }

  private closeSocket(): void {
    const current = this.socket
    this.socket = null
    this.socketReadyPromise = null
    this.socketAttempts.retire()
    this.serverInstanceId = null
    this.agentReexecSupported = null
    this.agentReexecAcks.rejectAll(new Error('PTY stream connection closed'))
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

  private async resolveEndpointOrThrow() {
    return await resolveRemotePtyEndpointConnection(this.topology, this.endpointId)
  }

  private handleMessage(raw: string): void {
    this.messageHandler(raw)
  }

  private handleSocketMessage(socket: WebSocket, raw: string): void {
    if (this.socket !== socket) {
      return
    }
    this.handleMessage(raw)
  }

  private handleSocketClosed(socket: WebSocket): void {
    if (this.socket && this.socket !== socket) {
      return
    }
    if (this.socket === socket) {
      this.closeSocket()
    }
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
  }

  private async connectSocket(attempt: PtyStreamSocketAttempt): Promise<void> {
    const endpoint = await this.resolveEndpointOrThrow()
    this.socketAttempts.assertCurrent(attempt)
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
      this.handleSocketMessage(ws, text)
    })

    ws.once('close', () => {
      this.handleSocketClosed(ws)
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

    this.socketAttempts.assertCurrent(attempt)
    if (this.socket !== ws) {
      throw new Error('PTY stream connection changed before handshake.')
    }
    this.socketHandshakePromise = new Promise<void>((resolvePromise, rejectPromise) => {
      this.socketHandshakeResolve = resolvePromise
      this.socketHandshakeReject = rejectPromise
    })
    const handshakePromise = this.socketHandshakePromise

    trySendRemotePtyWs(ws, {
      type: 'hello',
      protocolVersion: PTY_STREAM_PROTOCOL_VERSION,
      client: {
        kind: 'worker',
        version: null,
      },
    })

    const handshakeTimeout = setTimeout(() => {
      if (this.socket === ws && this.socketHandshakePromise === handshakePromise) {
        this.socketHandshakeReject?.(new Error('Timed out waiting for PTY hello_ack'))
      }
    }, 3_000)

    try {
      await handshakePromise
    } finally {
      clearTimeout(handshakeTimeout)
      if (this.socketHandshakePromise === handshakePromise) {
        this.socketHandshakePromise = null
      }
    }

    this.socketAttempts.assertCurrent(attempt)
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

    const attempt = this.socketAttempts.begin()
    const readyPromise = this.connectSocket(attempt)
    this.socketReadyPromise = readyPromise

    try {
      await readyPromise
    } catch (error) {
      if (this.socketReadyPromise === readyPromise && this.socketAttempts.isCurrent(attempt)) {
        this.closeSocket()
      }
      throw error
    } finally {
      if (this.socketReadyPromise === readyPromise) {
        this.socketReadyPromise = null
      }
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
    return await findRemotePtyEndpointSession({
      endpoint: await this.resolveEndpointOrThrow(),
      remoteSessionId,
      serverInstanceId: this.serverInstanceId,
      expectedServerInstanceId,
    })
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
    this.agentReexecAcks.rejectSession(remoteSessionId, new Error('Terminal session forgotten'))
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

  public async reexecAgent(
    input: TerminalAgentReexecRuntimeInput,
  ): Promise<TerminalAgentReexecResult> {
    await this.ensureSocket()
    return await reexecRemotePtyEndpointAgent({
      socket: this.socket,
      supported: this.agentReexecSupported === true,
      acknowledgements: this.agentReexecAcks,
      attached: this.attachedSessions.get(input.sessionId),
      input,
    })
  }

  public async resize(input: ResizeTerminalInput): Promise<TerminalGeometryCommitResult> {
    await this.ensureSocket()
    return await resizeRemotePtyEndpoint({
      socket: this.socket,
      acknowledgements: this.geometryAcks,
      attached: this.attachedSessions.get(input.sessionId),
      input,
    })
  }

  public kill(remoteSessionId: string): void {
    void this.resolveEndpointOrThrow()
      .then(async endpoint => await killRemotePtyEndpointSession({ endpoint, remoteSessionId }))
      .catch(() => undefined)
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
