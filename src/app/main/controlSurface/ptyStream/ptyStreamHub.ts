import { getPublicTerminalSpawnCommand } from '../../../../platform/terminal/publicTerminalSpawnCommand'
import { PtyStreamInputEvidence } from './ptyStreamInputEvidence'
import type { ClaudeTranscriptObservation } from '../../../../shared/runtime/agentHook/claudeTranscript'
import type { ReservedSessionInput } from '../../../../contexts/agent/application/ports/PromptDeliveryPorts'
import { withSessionInputOperation } from './ptyStreamSessionInput'
import type { AgentRunStateRuntime } from '../../../../contexts/agent/application/AgentRunStateRuntime'
import { createWorkerAgentRunState, connectAgentRunStateTransport } from './ptyStreamAgentRunState'
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
  broadcastForeground,
  broadcastSessionMetadata,
  broadcastState,
  buildSessionList,
  createPtyStreamBroadcaster,
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
import { listPtyStreamAgentActivityMetadata } from './ptyStreamAgentActivityBaseline'
import {
  reexecPtyStreamAgent,
  type PtyStreamHubAgentReexecOptions,
} from './ptyStreamHub.agentReexec'
import { PtyStreamRecoveryOperationTracker } from './ptyStreamRecoveryOperationTracker'
import { registerPtyStreamAgentMetadata } from './ptyStreamAgentMetadataProjection'
import { registerPtyClient, unregisterPtyClient } from './ptyStreamHub.clients'
import { writeAutomationInput } from './ptyStreamAutomation'
import { forgetPtyStreamSession, PtyStreamRetiredSessions } from './ptyStreamHub.retirement'

export class PtyStreamHub {
  public readonly agentRuns: AgentRunStateRuntime
  private readonly ptyRuntime: ControlSurfacePtyRuntime
  private readonly replayWindowMaxBytes: number
  private readonly onPresentationMutation: ((sessionId: string) => void) | undefined

  private readonly inputEvidence: PtyStreamInputEvidence
  public watchInput(
    sessionId: string,
    listener: (deliveryId?: string, data?: string) => void,
  ): () => void {
    return this.inputEvidence.watch(sessionId, listener)
  }

  public watchInputInvalidation(sessionId: string, listener: () => void): () => void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      listener()
      return () => {}
    }
    return session.ingress.watchInvalidation(listener)
  }

  private readonly sessions = new Map<string, SessionState>()
  private readonly clients = new Map<string, ClientState>()
  private readonly broadcast = createPtyStreamBroadcaster(this.sessions, this.clients)
  private readonly recoveryOperations = new PtyStreamRecoveryOperationTracker()
  private readonly retiredSessions = new PtyStreamRetiredSessions()

  public constructor(options: {
    ptyRuntime: ControlSurfacePtyRuntime
    agentRuns?: AgentRunStateRuntime
    replayWindowMaxBytes: number
    onPresentationMutation?: (sessionId: string) => void
    now?: () => number
  }) {
    this.inputEvidence = new PtyStreamInputEvidence(options.ptyRuntime)
    this.ptyRuntime = this.inputEvidence.observedRuntime()
    this.replayWindowMaxBytes = Math.max(64_000, Math.floor(options.replayWindowMaxBytes))
    this.onPresentationMutation = options.onPresentationMutation
    this.agentRuns =
      options.agentRuns ?? createWorkerAgentRunState(undefined, options.now ?? Date.now)
    connectAgentRunStateTransport(
      this.agentRuns,
      id => this.ensureSession(id),
      event => broadcastState({ sessions: this.sessions, clients: this.clients, event }),
    )
  }

  private ensureSession(sessionId: string): SessionState {
    if (this.retiredSessions.has(sessionId)) {
      throw new Error('Ephemeral PTY session was retired.')
    }
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
      broadcastControlChanged: sessionId => this.broadcast.controlChanged(sessionId),
    })
  }

  public registerClient(options: {
    clientId: string
    kind: PtyStreamClientKind
    ws: WebSocket
  }): void {
    registerPtyClient(this.clients, options)
  }

  public unregisterClient(clientId: string): void {
    unregisterPtyClient(this.clients, clientId, (id, sessionId) => this.detach(id, sessionId))
  }

  public registerSessionMetadata(metadata: SessionMetadata): void {
    if (this.retiredSessions.has(metadata.sessionId)) {
      return
    }
    const session = this.ensureSession(metadata.sessionId)
    session.metadata = { ...metadata, ...getPublicTerminalSpawnCommand(metadata) }
    session.presentationSession.resize(metadata.cols, metadata.rows)
  }

  public registerClaudeTranscript(record: ClaudeTranscriptObservation): void {
    if (!this.retiredSessions.has(record.sessionId)) {
      this.agentRuns.observeClaudeTranscript(record)
    }
  }

  public registerSessionAgentState(options: TerminalSessionStateEvent): void {
    if (this.retiredSessions.has(options.sessionId)) {
      return
    }
    this.ensureSession(options.sessionId)
    this.agentRuns.observe(options)
  }

  public registerSessionForeground(event: TerminalForegroundEvent): void {
    broadcastForeground({ sessions: this.sessions, clients: this.clients, event })
  }

  public registerSessionAgentMetadata(metadata: TerminalSessionMetadataEvent): void {
    if (this.retiredSessions.has(metadata.sessionId)) {
      return
    }
    registerPtyStreamAgentMetadata(
      this.ensureSession(metadata.sessionId),
      metadata,
      this.agentRuns,
      next =>
        broadcastSessionMetadata({
          sessions: this.sessions,
          clients: this.clients,
          metadata: next,
        }),
    )
  }

  public getSessionMetadata(sessionId: string): SessionMetadata | null {
    const metadata = this.sessions.get(sessionId)?.metadata
    return metadata ? { ...metadata, args: [...metadata.args] } : null
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  public isSessionActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'running'
  }

  public forgetSession(sessionId: string): void {
    this.agentRuns.forget(sessionId)
    forgetPtyStreamSession(sessionId, this.sessions, this.clients)
  }

  /** Final cleanup for ephemeral jobs; delayed runtime events must not revive them. */
  public retireSession(sessionId: string): void {
    this.retiredSessions.retire(sessionId)
    this.forgetSession(sessionId)
  }

  private flushSession(session: SessionState): void {
    flushBufferedSessionData({
      session,
      replayWindowMaxBytes: this.replayWindowMaxBytes,
      onChunk: (seq, data) => {
        void session.presentationSession.applyOutput(seq, data)
        this.broadcast.data(session.sessionId, seq, data)
      },
    })
  }

  private queueSessionData(sessionId: string, data: string): void {
    const session = this.ensureSession(sessionId)
    session.ingress.feed(data)
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
    if (this.retiredSessions.has(sessionId)) {
      return
    }
    this.queueSessionData(sessionId, data)
  }

  public handlePtyExit(sessionId: string, exitCode: number): void {
    this.agentRuns.exit(sessionId)
    if (this.retiredSessions.has(sessionId)) {
      return
    }
    const session = this.ensureSession(sessionId)
    if (session.status === 'exited') {
      return
    }

    this.flushSession(session)
    session.status = 'exited'
    session.exitCode = exitCode
    session.agentStateBySource.clear()
    session.agentMetadata = null
    this.broadcast.exit(sessionId, session.seq, exitCode)
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
    session.inputGeneration = {}
    session.ingress.reset()
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
      broadcastControlChanged: sessionId => this.broadcast.controlChanged(sessionId),
    })
  }

  public detach(clientId: string, sessionId: string): void {
    detachPtyStreamClient({
      clients: this.clients,
      sessions: this.sessions,
      clientId,
      sessionId,
      broadcastControlChanged: currentSessionId => this.broadcast.controlChanged(currentSessionId),
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
      broadcastControlChanged: sessionId => this.broadcast.controlChanged(sessionId),
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

  public withSessionInputOperation<T>(
    sessionId: string,
    callback: (input: ReservedSessionInput) => Promise<T>,
  ): Promise<T> {
    return withSessionInputOperation<T>(
      this.sessions,
      (id, data, deliveryId) => this.inputEvidence.write(id, data, deliveryId),
      sessionId,
      callback,
    )
  }

  public writeAutomation(
    input: Omit<Parameters<typeof writeAutomationInput>[0], 'sessions' | 'runtime'>,
  ) {
    return writeAutomationInput({ ...input, sessions: this.sessions, runtime: this.ptyRuntime })
  }
  public observeAgentState(sessionId: string) {
    return this.agentRuns.registry.get({ sessionId })
  }

  public async resize(options: PtyStreamHubResizeOptions): Promise<TerminalGeometryCommitResult> {
    return await this.recoveryOperations.track(
      resizePtyStreamSession({
        sessions: this.sessions,
        clients: this.clients,
        ptyRuntime: this.ptyRuntime,
        resize: options,
        broadcastGeometry: (sessionId, cols, rows, reason, revision) => {
          this.broadcast.geometry(sessionId, cols, rows, reason, revision)
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
