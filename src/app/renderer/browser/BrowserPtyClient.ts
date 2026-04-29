import type {
  AttachTerminalInput,
  DetachTerminalInput,
  KillTerminalInput,
  PresentationSnapshotTerminalInput,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalGeometryEvent,
  TerminalResyncEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  WriteTerminalInput,
} from '@shared/contracts/dto'
import { getBrowserQueryToken, invokeBrowserControlSurface } from './browserControlSurface'
import { BrowserPtyClientMetadataWatcher } from './BrowserPtyClientMetadataWatcher'

type UnsubscribeFn = () => void

type PtyListenerMap<TEvent> = Set<(event: TEvent) => void>

type AttachedSessionState = {
  lastSeq: number
}

function normalizeAttachAfterSeq(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }

  return Math.floor(value)
}

function emitToListeners<TEvent>(listeners: PtyListenerMap<TEvent>, event: TEvent): void {
  listeners.forEach(listener => {
    listener(event)
  })
}

function normalizeTerminalSessionState(value: unknown): 'working' | 'standby' | null {
  if (value === 'working' || value === 'standby') {
    return value
  }

  return null
}

function resolvePtyWebSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getBrowserQueryToken()
  const url = new URL(`${scheme}//${window.location.host}/pty`)
  if (token) {
    url.searchParams.set('token', token)
  }
  return url.toString()
}

export class BrowserPtyClient {
  private socket: WebSocket | null = null
  private socketReadyPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private attachedSessions = new Map<string, AttachedSessionState>()
  private readonly dataListeners = new Set<(event: TerminalDataEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()
  private readonly geometryListeners = new Set<(event: TerminalGeometryEvent) => void>()
  private readonly resyncListeners = new Set<(event: TerminalResyncEvent) => void>()
  private readonly stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  private readonly metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  private readonly latestStateBySessionId = new Map<string, TerminalSessionStateEvent>()
  private readonly latestMetadataBySessionId = new Map<string, TerminalSessionMetadataEvent>()
  private readonly metadataWatcher = new BrowserPtyClientMetadataWatcher({
    hasListeners: () => this.metadataListeners.size > 0,
    emit: event => {
      this.latestMetadataBySessionId.set(event.sessionId, event)
      emitToListeners(this.metadataListeners, event)
    },
  })

  private ensureSocket(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    if (this.socketReadyPromise) {
      return this.socketReadyPromise
    }

    this.socketReadyPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(resolvePtyWebSocketUrl(), ['opencove-pty.v1'])
      this.socket = socket

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            client: {
              kind: 'web',
              version: null,
            },
          }),
        )

        for (const [sessionId, state] of this.attachedSessions) {
          socket.send(
            JSON.stringify({
              type: 'attach',
              sessionId,
              afterSeq: state.lastSeq > 0 ? state.lastSeq : undefined,
              role: 'controller',
            }),
          )
        }

        this.socketReadyPromise = null
        resolve()
      })

      socket.addEventListener('message', event => {
        void this.handleMessage(String(event.data))
      })

      socket.addEventListener('close', () => {
        this.socket = null
        this.socketReadyPromise = null

        if (this.reconnectTimer !== null) {
          window.clearTimeout(this.reconnectTimer)
        }

        if (this.attachedSessions.size > 0) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            void this.ensureSocket().catch(() => undefined)
          }, 500)
        }
      })

      socket.addEventListener('error', () => {
        reject(new Error('PTY stream connection failed'))
      })
    })

    return this.socketReadyPromise
  }

  private async handleMessage(raw: string): Promise<void> {
    let payload: unknown
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return
    }

    if (!payload || typeof payload !== 'object') {
      return
    }

    const record = payload as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : null
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null

    if (!type || !sessionId) {
      return
    }

    if (type === 'attached') {
      const seq =
        typeof record.seq === 'number' && Number.isFinite(record.seq) ? Math.floor(record.seq) : 0
      const existing = this.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      } else {
        this.attachedSessions.set(sessionId, { lastSeq: seq })
      }
      return
    }

    if (type === 'data') {
      const data = typeof record.data === 'string' ? record.data : ''
      const seq =
        typeof record.seq === 'number' && Number.isFinite(record.seq) ? Math.floor(record.seq) : 0
      const existing = this.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }
      emitToListeners(this.dataListeners, { sessionId, data, seq })
      return
    }

    if (type === 'exit') {
      const exitCode =
        typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
          ? Math.floor(record.exitCode)
          : 0
      emitToListeners(this.exitListeners, { sessionId, exitCode })
      return
    }

    if (type === 'geometry') {
      const cols =
        typeof record.cols === 'number' && Number.isFinite(record.cols)
          ? Math.floor(record.cols)
          : 0
      const rows =
        typeof record.rows === 'number' && Number.isFinite(record.rows)
          ? Math.floor(record.rows)
          : 0
      const reason =
        record.reason === 'frame_commit' || record.reason === 'appearance_commit'
          ? record.reason
          : null

      if (cols <= 0 || rows <= 0 || !reason) {
        return
      }

      emitToListeners(this.geometryListeners, { sessionId, cols, rows, reason })
      return
    }

    if (type === 'state') {
      const state = normalizeTerminalSessionState(record.state)
      if (!state) {
        return
      }

      const eventPayload: TerminalSessionStateEvent = { sessionId, state }
      this.latestStateBySessionId.set(sessionId, eventPayload)
      emitToListeners(this.stateListeners, eventPayload)
      return
    }

    if (type === 'metadata') {
      const resumeSessionId =
        typeof record.resumeSessionId === 'string' && record.resumeSessionId.trim().length > 0
          ? record.resumeSessionId.trim()
          : null
      const profileId =
        typeof record.profileId === 'string' && record.profileId.trim().length > 0
          ? record.profileId.trim()
          : null
      const runtimeKind =
        record.runtimeKind === 'windows' ||
        record.runtimeKind === 'wsl' ||
        record.runtimeKind === 'posix'
          ? record.runtimeKind
          : null

      const eventPayload: TerminalSessionMetadataEvent = {
        sessionId,
        resumeSessionId,
        ...(profileId ? { profileId } : {}),
        ...(runtimeKind ? { runtimeKind } : {}),
      }
      this.latestMetadataBySessionId.set(sessionId, eventPayload)
      emitToListeners(this.metadataListeners, eventPayload)
      this.metadataWatcher.cancel(sessionId)
      return
    }

    if (type === 'overflow') {
      const reason = record.reason === 'replay_window_exceeded' ? record.reason : null
      const recovery = record.recovery === 'presentation_snapshot' ? record.recovery : null

      if (!reason || !recovery) {
        return
      }

      emitToListeners(this.resyncListeners, {
        sessionId,
        reason,
        recovery,
      })
      return
    }
  }

  private async sendSocketMessage(payload: unknown): Promise<void> {
    await this.ensureSocket()
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('PTY stream socket is not open')
    }
    this.socket.send(JSON.stringify(payload))
  }

  public listProfiles(): Promise<{ profiles: []; defaultProfileId: null }> {
    return Promise.resolve({ profiles: [], defaultProfileId: null })
  }

  public async spawn(payload: SpawnTerminalInput): Promise<SpawnTerminalResult> {
    const { sessionId, profileId, runtimeKind } = await invokeBrowserControlSurface<{
      sessionId: string
      startedAt: string
      cwd: string
      command: string
      args: string[]
      executionContext: unknown
      profileId?: string | null
      runtimeKind?: 'windows' | 'wsl' | 'posix'
    }>({
      kind: 'command',
      id: 'pty.spawn',
      payload,
    })

    return {
      sessionId,
      profileId: profileId ?? null,
      runtimeKind: runtimeKind ?? undefined,
    }
  }

  public async write(payload: WriteTerminalInput): Promise<void> {
    await this.sendSocketMessage({
      type: 'write',
      sessionId: payload.sessionId,
      data: payload.data,
    })
  }

  public async resize(payload: ResizeTerminalInput): Promise<void> {
    await this.sendSocketMessage({
      type: 'resize',
      sessionId: payload.sessionId,
      cols: payload.cols,
      rows: payload.rows,
      reason: payload.reason,
    })
  }

  public async kill(payload: KillTerminalInput): Promise<void> {
    await invokeBrowserControlSurface<void>({
      kind: 'command',
      id: 'session.kill',
      payload: { sessionId: payload.sessionId },
    })
  }

  public async attach(payload: AttachTerminalInput): Promise<void> {
    const state = this.attachedSessions.get(payload.sessionId) ?? { lastSeq: 0 }
    const afterSeq = normalizeAttachAfterSeq(payload.afterSeq)
    if (afterSeq !== null) {
      state.lastSeq = Math.max(state.lastSeq, afterSeq)
    }
    this.attachedSessions.set(payload.sessionId, state)

    await this.sendSocketMessage({
      type: 'attach',
      sessionId: payload.sessionId,
      afterSeq: state.lastSeq > 0 ? state.lastSeq : undefined,
      role: 'controller',
    })

    this.metadataWatcher.ensure(payload.sessionId)
  }

  public async detach(payload: DetachTerminalInput): Promise<void> {
    this.attachedSessions.delete(payload.sessionId)
    this.metadataWatcher.cancel(payload.sessionId)
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    this.socket.send(
      JSON.stringify({
        type: 'detach',
        sessionId: payload.sessionId,
      }),
    )
  }

  public async snapshot(payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> {
    const snapshot = await invokeBrowserControlSurface<{
      sessionId: string
      fromSeq: number
      toSeq: number
      scrollback: string
      truncated: boolean
    }>({
      kind: 'query',
      id: 'session.snapshot',
      payload,
    })

    const existing = this.attachedSessions.get(payload.sessionId)
    if (existing) {
      existing.lastSeq = Math.max(existing.lastSeq, snapshot.toSeq)
    }

    return { data: snapshot.scrollback }
  }

  public async presentationSnapshot(
    payload: PresentationSnapshotTerminalInput,
  ): Promise<PresentationSnapshotTerminalResult> {
    const snapshot = await invokeBrowserControlSurface<PresentationSnapshotTerminalResult>({
      kind: 'query',
      id: 'session.presentationSnapshot',
      payload,
    })

    const existing = this.attachedSessions.get(payload.sessionId)
    if (existing) {
      existing.lastSeq = Math.max(existing.lastSeq, snapshot.appliedSeq)
    }

    return snapshot
  }

  public async debugCrashHost(): Promise<void> {
    throw new Error('PTY host crash is unavailable in browser runtime')
  }

  public onData(listener: (event: TerminalDataEvent) => void): UnsubscribeFn {
    this.dataListeners.add(listener)
    return () => {
      this.dataListeners.delete(listener)
    }
  }

  public onExit(listener: (event: TerminalExitEvent) => void): UnsubscribeFn {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  public onGeometry(listener: (event: TerminalGeometryEvent) => void): UnsubscribeFn {
    this.geometryListeners.add(listener)
    return () => {
      this.geometryListeners.delete(listener)
    }
  }

  public onResync(listener: (event: TerminalResyncEvent) => void): UnsubscribeFn {
    this.resyncListeners.add(listener)
    return () => {
      this.resyncListeners.delete(listener)
    }
  }

  public onState(listener: (event: TerminalSessionStateEvent) => void): UnsubscribeFn {
    this.stateListeners.add(listener)
    this.latestStateBySessionId.forEach(event => {
      listener(event)
    })
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  public onMetadata(listener: (event: TerminalSessionMetadataEvent) => void): UnsubscribeFn {
    this.metadataListeners.add(listener)
    this.latestMetadataBySessionId.forEach(event => {
      listener(event)
    })
    return () => {
      this.metadataListeners.delete(listener)
    }
  }
}
