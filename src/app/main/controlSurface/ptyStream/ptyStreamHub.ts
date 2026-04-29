import type { WebSocket } from 'ws'
import type {
  GetSessionPresentationSnapshotResult,
  GetSessionSnapshotResult,
  ListSessionsResult,
  TerminalSessionMetadataEvent,
  TerminalSessionState,
} from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { PtyStreamClientKind, PtyStreamRole } from './ptyStreamTypes'
import {
  sendPtyAttached,
  sendPtyData,
  sendPtyError,
  sendPtyExit,
  sendPtyOverflow,
  sendPtySessionMetadata,
  sendPtyState,
  toControllerDto,
} from './ptyStreamWire'
import type { SessionMetadata, SessionState, ClientState } from './ptyStreamState'
import {
  broadcastControlChanged,
  broadcastData,
  broadcastExit,
  broadcastGeometry,
  broadcastSessionMetadata,
  broadcastState,
  buildSessionList,
  setSessionController,
} from './ptyStreamHub.broadcast'
import {
  createSessionState,
  flushBufferedSessionData,
  queueBufferedSessionData,
  scheduleSessionFlush,
  snapshotSessionPresentation,
  snapshotSessionScrollback,
} from './ptyStreamHub.support'
import { logPtyStreamResizeDiagnostics } from './ptyStreamDiagnostics'

export class PtyStreamHub {
  private readonly ptyRuntime: ControlSurfacePtyRuntime
  private readonly replayWindowMaxBytes: number

  private readonly sessions = new Map<string, SessionState>()
  private readonly clients = new Map<string, ClientState>()

  public constructor(options: {
    ptyRuntime: ControlSurfacePtyRuntime
    replayWindowMaxBytes: number
  }) {
    this.ptyRuntime = options.ptyRuntime
    this.replayWindowMaxBytes = Math.max(64_000, Math.floor(options.replayWindowMaxBytes))
  }

  private ensureSession(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }

    const created = createSessionState(sessionId)

    this.sessions.set(sessionId, created)
    return created
  }

  private setSessionController(session: SessionState, controllerClientId: string | null): void {
    setSessionController({
      session,
      controllerClientId,
      clients: this.clients,
      broadcastControlChanged: sessionId => this.broadcastControlChanged(sessionId),
    })
  }

  public registerClient(options: {
    clientId: string
    kind: PtyStreamClientKind
    ws: WebSocket
  }): void {
    this.clients.set(options.clientId, {
      clientId: options.clientId,
      kind: options.kind,
      ws: options.ws,
      rolesBySessionId: new Map(),
    })
  }

  public unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) {
      return
    }

    for (const sessionId of client.rolesBySessionId.keys()) {
      this.detach(clientId, sessionId)
    }

    this.clients.delete(clientId)
  }

  public registerSessionMetadata(metadata: SessionMetadata): void {
    const session = this.ensureSession(metadata.sessionId)
    session.metadata = metadata
    session.presentationSession.resize(metadata.cols, metadata.rows)
  }

  public registerSessionAgentState(options: {
    sessionId: string
    state: TerminalSessionState
  }): void {
    const session = this.ensureSession(options.sessionId)
    if (session.agentState === options.state) {
      return
    }

    session.agentState = options.state
    this.broadcastState(options.sessionId, options.state)
  }

  public registerSessionAgentMetadata(metadata: TerminalSessionMetadataEvent): void {
    const session = this.ensureSession(metadata.sessionId)
    const previous = session.agentMetadata
    const unchanged =
      previous?.resumeSessionId === metadata.resumeSessionId &&
      previous?.profileId === metadata.profileId &&
      previous?.runtimeKind === metadata.runtimeKind

    if (unchanged) {
      return
    }

    session.agentMetadata = metadata
    this.broadcastSessionMetadata(metadata)
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  public forgetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }

    for (const clientId of session.subscribers) {
      const client = this.clients.get(clientId)
      client?.rolesBySessionId.delete(sessionId)
    }

    session.presentationSession.dispose()
    this.sessions.delete(sessionId)
  }

  private flushSession(session: SessionState): void {
    flushBufferedSessionData({
      session,
      replayWindowMaxBytes: this.replayWindowMaxBytes,
      onChunk: (seq, data) => {
        void session.presentationSession.applyOutput(seq, data)
        this.broadcastData(session.sessionId, seq, data)
      },
    })
  }

  private queueSessionData(sessionId: string, data: string): void {
    const session = this.ensureSession(sessionId)
    const shouldFlush = queueBufferedSessionData(session, data)
    if (shouldFlush) {
      this.flushSession(session)
      return
    }

    scheduleSessionFlush(session, () => {
      this.flushSession(session)
    })
  }

  public handlePtyData(sessionId: string, data: string): void {
    this.queueSessionData(sessionId, data)
  }

  public handlePtyExit(sessionId: string, exitCode: number): void {
    const session = this.ensureSession(sessionId)
    if (session.status === 'exited') {
      return
    }

    this.flushSession(session)
    session.status = 'exited'
    session.exitCode = exitCode
    this.broadcastExit(sessionId, session.seq, exitCode)
  }

  public listSessions(): ListSessionsResult {
    return buildSessionList({
      sessions: this.sessions.values(),
      clients: this.clients,
    })
  }

  public snapshotSession(sessionId: string): GetSessionSnapshotResult {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown session')
    }

    this.flushSession(session)
    return snapshotSessionScrollback(session)
  }

  public async presentationSnapshotSession(
    sessionId: string,
  ): Promise<GetSessionPresentationSnapshotResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown session')
    }

    this.flushSession(session)
    return await snapshotSessionPresentation(session)
  }

  private broadcastData(sessionId: string, seq: number, data: string): void {
    broadcastData({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
      seq,
      data,
    })
  }

  private broadcastExit(sessionId: string, seq: number, exitCode: number): void {
    broadcastExit({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
      seq,
      exitCode,
    })
  }

  private broadcastGeometry(
    sessionId: string,
    cols: number,
    rows: number,
    reason: 'frame_commit' | 'appearance_commit',
  ): void {
    broadcastGeometry({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
      cols,
      rows,
      reason,
    })
  }

  private broadcastControlChanged(sessionId: string): void {
    broadcastControlChanged({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
    })
  }

  private broadcastState(sessionId: string, state: TerminalSessionState): void {
    broadcastState({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
      state,
    })
  }

  private broadcastSessionMetadata(metadata: TerminalSessionMetadataEvent): void {
    broadcastSessionMetadata({
      sessions: this.sessions,
      clients: this.clients,
      metadata,
    })
  }

  public attach(options: {
    clientId: string
    sessionId: string
    afterSeq?: number | null
    role?: PtyStreamRole | null
  }): void {
    const client = this.clients.get(options.clientId)
    if (!client) {
      return
    }

    const session = this.sessions.get(options.sessionId)
    if (!session) {
      sendPtyError(client.ws, options.sessionId, 'session.not_found', 'Unknown session.')
      return
    }

    this.flushSession(session)

    const wantsController =
      options.role === 'controller' || options.role === null || options.role === undefined
    const hasController = Boolean(session.controllerClientId)
    const role: PtyStreamRole = wantsController && !hasController ? 'controller' : 'viewer'

    session.subscribers.add(client.clientId)
    client.rolesBySessionId.set(options.sessionId, role)

    if (role === 'controller' && !session.controllerClientId) {
      this.setSessionController(session, client.clientId)
    }

    const controllerClient = session.controllerClientId
      ? (this.clients.get(session.controllerClientId) ?? null)
      : null

    const earliestSeq = session.chunks[0]?.seq ?? session.seq
    sendPtyAttached(
      client.ws,
      options.sessionId,
      role,
      session.seq,
      earliestSeq,
      toControllerDto(controllerClient),
    )

    if (session.agentMetadata) {
      sendPtySessionMetadata(client.ws, session.agentMetadata)
    }

    if (session.agentState) {
      sendPtyState(client.ws, options.sessionId, session.agentState)
    }

    const afterSeq =
      typeof options.afterSeq === 'number' && Number.isFinite(options.afterSeq)
        ? Math.floor(options.afterSeq)
        : null
    const effectiveAfterSeq = afterSeq === null ? earliestSeq - 1 : afterSeq

    if (effectiveAfterSeq < earliestSeq - 1) {
      sendPtyOverflow(client.ws, options.sessionId, session.seq, earliestSeq)
    } else {
      for (const chunk of session.chunks) {
        if (chunk.seq <= effectiveAfterSeq) {
          continue
        }

        sendPtyData(client.ws, options.sessionId, chunk.seq, chunk.data)
      }
    }

    if (session.status === 'exited' && typeof session.exitCode === 'number') {
      sendPtyExit(client.ws, options.sessionId, session.seq, session.exitCode)
    }
  }

  public detach(clientId: string, sessionId: string): void {
    const client = this.clients.get(clientId)
    const session = this.sessions.get(sessionId)
    if (!client || !session) {
      return
    }

    session.subscribers.delete(clientId)
    client.rolesBySessionId.delete(sessionId)

    if (session.controllerClientId === clientId) {
      this.setSessionController(session, null)
    }
  }

  public requestControl(options: { clientId: string; sessionId: string }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    if (!session.subscribers.has(options.clientId)) {
      sendPtyError(client.ws, options.sessionId, 'session.not_attached', 'Not attached.')
      return
    }

    this.setSessionController(session, options.clientId)
  }

  public releaseControl(options: { clientId: string; sessionId: string }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    if (session.controllerClientId !== options.clientId) {
      return
    }

    this.setSessionController(session, null)
  }

  public write(options: { clientId: string; sessionId: string; data: string }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    if (!session.subscribers.has(options.clientId)) {
      sendPtyError(client.ws, options.sessionId, 'session.not_attached', 'Not attached.')
      return
    }

    if (session.controllerClientId !== options.clientId) {
      this.setSessionController(session, options.clientId)
    }

    this.ptyRuntime.write(options.sessionId, options.data)
  }

  public resize(options: {
    clientId: string
    sessionId: string
    cols: number
    rows: number
    reason?: 'frame_commit' | 'appearance_commit' | null
  }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    if (session.controllerClientId !== options.clientId) {
      sendPtyError(
        client.ws,
        options.sessionId,
        'session.not_controller',
        'Only controller can resize.',
      )
      return
    }

    const geometry = session.presentationSession.resize(options.cols, options.rows)
    const resizeReason = options.reason ?? 'frame_commit'
    if (!geometry.changed) {
      logPtyStreamResizeDiagnostics({
        event: 'stream-unchanged',
        sessionId: options.sessionId,
        clientId: options.clientId,
        requestedCols: options.cols,
        requestedRows: options.rows,
        cols: geometry.cols,
        rows: geometry.rows,
        reason: resizeReason,
      })
      return
    }

    logPtyStreamResizeDiagnostics({
      event: 'stream-forwarded',
      sessionId: options.sessionId,
      clientId: options.clientId,
      requestedCols: options.cols,
      requestedRows: options.rows,
      cols: geometry.cols,
      rows: geometry.rows,
      reason: resizeReason,
    })

    if (session.metadata) {
      session.metadata = {
        ...session.metadata,
        cols: geometry.cols,
        rows: geometry.rows,
      }
    }
    this.broadcastGeometry(options.sessionId, geometry.cols, geometry.rows, resizeReason)

    this.ptyRuntime.resize(options.sessionId, geometry.cols, geometry.rows, resizeReason)
  }
}
