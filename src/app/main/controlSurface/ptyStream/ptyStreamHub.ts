import type { WebSocket } from 'ws'
import type { GetSessionSnapshotResult, ListSessionsResult } from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { PtyStreamClientKind, PtyStreamRole } from './ptyStreamTypes'
import {
  sendPtyAttached,
  sendPtyControlChanged,
  sendPtyData,
  sendPtyError,
  sendPtyExit,
  sendPtyOverflow,
  toControllerDto,
} from './ptyStreamWire'
import type { SessionMetadata, SessionState, ClientState } from './ptyStreamState'

const PTY_DATA_FLUSH_DELAY_MS = 32
const PTY_DATA_MAX_BATCH_CHARS = 256_000

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

    const created: SessionState = {
      sessionId,
      metadata: null,
      status: 'running',
      exitCode: null,
      seq: 0,
      chunks: [],
      totalBytes: 0,
      truncated: false,
      pendingChunks: [],
      pendingChars: 0,
      flushTimer: null,
      subscribers: new Set(),
      controllerClientId: null,
    }

    this.sessions.set(sessionId, created)
    return created
  }

  private setSessionController(session: SessionState, controllerClientId: string | null): void {
    session.controllerClientId = controllerClientId

    for (const subscriberId of session.subscribers) {
      const client = this.clients.get(subscriberId)
      if (!client) {
        continue
      }

      client.rolesBySessionId.set(
        session.sessionId,
        subscriberId === controllerClientId ? 'controller' : 'viewer',
      )
    }

    this.broadcastControlChanged(session.sessionId)
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

    this.sessions.delete(sessionId)
  }

  private flushSession(session: SessionState): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }

    const chunks = session.pendingChunks
    if (chunks.length === 0) {
      session.pendingChars = 0
      return
    }

    session.pendingChunks = []
    session.pendingChars = 0

    const data = chunks.length === 1 ? (chunks[0] ?? '') : chunks.join('')
    if (data.length === 0) {
      return
    }

    session.seq += 1
    const seq = session.seq

    if (data.length >= this.replayWindowMaxBytes) {
      session.chunks = [{ seq, data: data.slice(-this.replayWindowMaxBytes) }]
      session.totalBytes = this.replayWindowMaxBytes
      session.truncated = true
      this.broadcastData(session.sessionId, seq, session.chunks[0]?.data ?? '')
      return
    }

    session.chunks.push({ seq, data })
    session.totalBytes += data.length

    while (session.totalBytes > this.replayWindowMaxBytes && session.chunks.length > 0) {
      const head = session.chunks.shift()
      if (!head) {
        break
      }
      session.totalBytes -= head.data.length
      session.truncated = true
    }

    this.broadcastData(session.sessionId, seq, data)
  }

  private queueSessionData(sessionId: string, data: string): void {
    if (data.length === 0) {
      return
    }

    const session = this.ensureSession(sessionId)
    session.pendingChunks.push(data)
    session.pendingChars += data.length

    if (session.pendingChars >= PTY_DATA_MAX_BATCH_CHARS) {
      this.flushSession(session)
      return
    }

    if (session.flushTimer) {
      return
    }

    session.flushTimer = setTimeout(() => {
      this.flushSession(session)
    }, PTY_DATA_FLUSH_DELAY_MS)
  }

  public handlePtyData(sessionId: string, data: string): void {
    this.queueSessionData(sessionId, data)
  }

  public handlePtyExit(sessionId: string, exitCode: number): void {
    const session = this.ensureSession(sessionId)
    this.flushSession(session)
    session.status = 'exited'
    session.exitCode = exitCode
    this.broadcastExit(sessionId, session.seq, exitCode)
  }

  public listSessions(): ListSessionsResult {
    const sessions: ListSessionsResult['sessions'] = []

    for (const session of this.sessions.values()) {
      const metadata = session.metadata
      if (!metadata) {
        continue
      }

      const controllerClient = session.controllerClientId
        ? (this.clients.get(session.controllerClientId) ?? null)
        : null

      sessions.push({
        sessionId: session.sessionId,
        kind: metadata.kind,
        startedAt: metadata.startedAt,
        cwd: metadata.cwd,
        command: metadata.command,
        args: metadata.args,
        status: session.status,
        exitCode: session.exitCode,
        seq: session.seq,
        earliestSeq: session.chunks[0]?.seq ?? session.seq,
        controller: toControllerDto(controllerClient),
      })
    }

    return { sessions }
  }

  public snapshotSession(sessionId: string): GetSessionSnapshotResult {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Unknown session')
    }

    this.flushSession(session)

    const fromSeq = session.chunks[0]?.seq ?? session.seq
    const scrollback =
      session.chunks.length === 0 ? '' : session.chunks.map(chunk => chunk.data).join('')

    return {
      sessionId,
      fromSeq,
      toSeq: session.seq,
      scrollback,
      truncated: session.truncated,
    }
  }

  private broadcastData(sessionId: string, seq: number, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.subscribers.size === 0) {
      return
    }

    for (const clientId of session.subscribers) {
      const client = this.clients.get(clientId)
      if (!client) {
        continue
      }

      sendPtyData(client.ws, sessionId, seq, data)
    }
  }

  private broadcastExit(sessionId: string, seq: number, exitCode: number): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.subscribers.size === 0) {
      return
    }

    for (const clientId of session.subscribers) {
      const client = this.clients.get(clientId)
      if (!client) {
        continue
      }

      sendPtyExit(client.ws, sessionId, seq, exitCode)
    }
  }

  private broadcastControlChanged(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const controllerClient = session.controllerClientId
      ? (this.clients.get(session.controllerClientId) ?? null)
      : null
    const controllerDto = toControllerDto(controllerClient)

    for (const clientId of session.subscribers) {
      const client = this.clients.get(clientId)
      if (!client) {
        continue
      }

      const role = client.rolesBySessionId.get(sessionId) ?? 'viewer'

      sendPtyControlChanged(client.ws, sessionId, controllerDto, role)
    }
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

    this.ptyRuntime.resize(options.sessionId, options.cols, options.rows)
  }
}
