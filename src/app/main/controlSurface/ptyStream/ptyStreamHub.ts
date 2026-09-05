import type { WebSocket } from 'ws'
import type {
  GetSessionPresentationSnapshotResult,
  GetSessionSnapshotResult,
  ListSessionsResult,
  ListTerminalAgentActivityMetadataResult,
  PresentationSnapshotTerminalResult,
  TerminalForegroundEvent,
  TerminalAgentReexecResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  TerminalGeometryCommitResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { PtyStreamClientKind, PtyStreamRole } from './ptyStreamTypes'
import type { SessionMetadata, SessionState, ClientState } from './ptyStreamState'
import {
  broadcastControlChanged,
  broadcastData,
  broadcastExit,
  broadcastForeground,
  broadcastGeometry,
  broadcastSessionMetadata,
  broadcastState,
  buildSessionList,
} from './ptyStreamHub.broadcast'
import {
  createSessionState,
  flushBufferedSessionData,
  queueBufferedSessionData,
  scheduleSessionFlush,
  snapshotSessionPresentation,
  snapshotSessionScrollback,
} from './ptyStreamHub.support'
import { resizePtyStreamSession, type PtyStreamHubResizeOptions } from './ptyStreamHub.resize'
import { writePtyStreamSession } from './ptyStreamHub.write'
import { queuePtyStreamSessionControllerChange } from './ptyStreamHub.controller'
import {
  replacePtyStreamPresentationCurrent,
  restorePtyStreamPresentationBaseline,
} from './ptyStreamHub.presentationRecovery'
import { attachPtyStreamClient, detachPtyStreamClient } from './ptyStreamHub.attach'
import { registerPtyStreamAgentState } from './ptyStreamAgentStateReplay'
import { listPtyStreamAgentActivityMetadata } from './ptyStreamAgentActivityBaseline'
import {
  reexecPtyStreamAgent,
  type PtyStreamHubAgentReexecOptions,
} from './ptyStreamHub.agentReexec'
import { PtyStreamRecoveryOperationTracker } from './ptyStreamRecoveryOperationTracker'
import { projectPtyStreamAgentMetadata } from './ptyStreamAgentMetadataProjection'

export class PtyStreamHub {
  private readonly ptyRuntime: ControlSurfacePtyRuntime
  private readonly replayWindowMaxBytes: number
  private readonly onPresentationMutation: ((sessionId: string) => void) | undefined
  private readonly now: () => number

  private readonly sessions = new Map<string, SessionState>()
  private readonly clients = new Map<string, ClientState>()
  private readonly recoveryOperations = new PtyStreamRecoveryOperationTracker()

  public constructor(options: {
    ptyRuntime: ControlSurfacePtyRuntime
    replayWindowMaxBytes: number
    onPresentationMutation?: (sessionId: string) => void
    now?: () => number
  }) {
    this.ptyRuntime = options.ptyRuntime
    this.replayWindowMaxBytes = Math.max(64_000, Math.floor(options.replayWindowMaxBytes))
    this.onPresentationMutation = options.onPresentationMutation
    this.now = options.now ?? Date.now
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

  public async drainRecoveryOperations(): Promise<void> {
    await this.recoveryOperations.drain(this.sessions)
  }

  private setSessionController(
    session: SessionState,
    controllerClientId: string | null,
    expectedControllerClientId?: string | null,
    candidateIntent?: { clientId: string; eligible: boolean },
    requireAttachedClientId?: string,
  ): void {
    queuePtyStreamSessionControllerChange({
      clients: this.clients,
      sessions: this.sessions,
      session,
      controllerClientId,
      ...(expectedControllerClientId !== undefined ? { expectedControllerClientId } : {}),
      ...(candidateIntent ? { candidateIntent } : {}),
      ...(requireAttachedClientId ? { requireAttachedClientId } : {}),
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

  public registerSessionAgentState(options: TerminalSessionStateEvent): void {
    registerPtyStreamAgentState({
      session: this.ensureSession(options.sessionId),
      event: options,
      now: this.now,
      broadcast: event => this.broadcastState(event),
    })
  }

  public registerSessionForeground(event: TerminalForegroundEvent): void {
    broadcastForeground({ sessions: this.sessions, clients: this.clients, event })
  }

  public registerSessionAgentMetadata(metadata: TerminalSessionMetadataEvent): void {
    const session = this.ensureSession(metadata.sessionId)
    if (session.status === 'exited') {
      return
    }
    const next = projectPtyStreamAgentMetadata(session.agentMetadata, metadata)
    if (!next) {
      return
    }
    session.agentMetadata = next
    this.broadcastSessionMetadata(next)
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  public isSessionActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'running'
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
    session.agentStateBySource.clear()
    session.agentMetadata = null
    this.broadcastExit(sessionId, session.seq, exitCode)
  }

  public hasNativePiObservation(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.agentMetadata?.piSnapshot !== undefined
  }

  public listSessions(): ListSessionsResult {
    return buildSessionList({ sessions: this.sessions.values(), clients: this.clients })
  }

  public listTerminalAgentActivityMetadata(): ListTerminalAgentActivityMetadataResult {
    return listPtyStreamAgentActivityMetadata(this.sessions.values())
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
    const snapshot = await snapshotSessionPresentation(session)
    return {
      ...snapshot,
      serializedScreen: `${session.displayPrefix}${snapshot.serializedScreen}`,
    }
  }

  /** Snapshot used by persistence; excludes archived display-only history. */
  public async recoveryPresentationSnapshotSession(
    sessionId: string,
  ): Promise<GetSessionPresentationSnapshotResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown session')
    }
    this.flushSession(session)
    return await snapshotSessionPresentation(session)
  }

  public async restoreSessionPresentationBaseline(options: {
    sessionId: string
    serializedScreen: string
    displayPrefix?: string
  }): Promise<void> {
    const session = this.ensureSession(options.sessionId)
    await restorePtyStreamPresentationBaseline({
      session,
      serializedScreen: options.serializedScreen,
      ...(options.displayPrefix !== undefined ? { displayPrefix: options.displayPrefix } : {}),
    })
  }

  public async replaceSessionPresentationCurrent(options: {
    sessionId: string
    snapshot: PresentationSnapshotTerminalResult
  }): Promise<void> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      throw new Error('Unknown session')
    }
    await this.recoveryOperations.track(
      replacePtyStreamPresentationCurrent({
        ...options,
        session,
        sessions: this.sessions,
        clients: this.clients,
        flushSession: current => this.flushSession(current),
      }),
    )
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
    revision?: number | null,
  ): void {
    broadcastGeometry({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
      cols,
      rows,
      reason,
      revision,
    })
  }

  private broadcastControlChanged(sessionId: string): void {
    broadcastControlChanged({
      sessions: this.sessions,
      clients: this.clients,
      sessionId,
    })
  }

  private broadcastState(event: TerminalSessionStateEvent): void {
    broadcastState({
      sessions: this.sessions,
      clients: this.clients,
      event,
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
    attachPtyStreamClient({
      clients: this.clients,
      sessions: this.sessions,
      ...options,
      flushSession: session => this.flushSession(session),
      broadcastControlChanged: sessionId => this.broadcastControlChanged(sessionId),
    })
  }

  public detach(clientId: string, sessionId: string): void {
    detachPtyStreamClient({
      clients: this.clients,
      sessions: this.sessions,
      clientId,
      sessionId,
      broadcastControlChanged: currentSessionId => this.broadcastControlChanged(currentSessionId),
    })
  }

  public requestControl(options: { clientId: string; sessionId: string }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    this.setSessionController(
      session,
      options.clientId,
      undefined,
      {
        clientId: options.clientId,
        eligible: true,
      },
      options.clientId,
    )
  }

  public releaseControl(options: { clientId: string; sessionId: string }): void {
    const session = this.sessions.get(options.sessionId)
    const client = this.clients.get(options.clientId)
    if (!session || !client) {
      return
    }

    this.setSessionController(
      session,
      null,
      options.clientId,
      {
        clientId: options.clientId,
        eligible: false,
      },
      options.clientId,
    )
  }

  public write(options: { clientId: string; sessionId: string; data: string }): void {
    writePtyStreamSession({
      clients: this.clients,
      sessions: this.sessions,
      ptyRuntime: this.ptyRuntime,
      ...options,
      broadcastControlChanged: sessionId => this.broadcastControlChanged(sessionId),
    })
  }

  public async reexecAgent(
    input: PtyStreamHubAgentReexecOptions,
  ): Promise<TerminalAgentReexecResult> {
    return await this.recoveryOperations.track(
      reexecPtyStreamAgent({
        clients: this.clients,
        sessions: this.sessions,
        ptyRuntime: this.ptyRuntime,
        input,
      }),
    )
  }

  public async resize(options: PtyStreamHubResizeOptions): Promise<TerminalGeometryCommitResult> {
    return await this.recoveryOperations.track(
      resizePtyStreamSession({
        sessions: this.sessions,
        clients: this.clients,
        ptyRuntime: this.ptyRuntime,
        resize: options,
        broadcastGeometry: (sessionId, cols, rows, reason, revision) => {
          this.broadcastGeometry(sessionId, cols, rows, reason, revision)
        },
      }).then(result => {
        if (result.changed) {
          this.onPresentationMutation?.(options.sessionId)
        }
        return result
      }),
    )
  }
}
