import type {
  AttachTerminalInput,
  AttachTerminalResult,
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
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  TerminalExitEvent,
  TerminalGeometryEvent,
  TerminalGeometryCommitResult,
  TerminalResyncEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  WriteTerminalInput,
} from '@shared/contracts/dto'
import { invokeBrowserControlSurface } from './browserControlSurface'
import { BrowserPtyGeometryAckCoordinator } from './BrowserPtyGeometryAckCoordinator'
import { BrowserPtyClientMetadataWatcher } from './BrowserPtyClientMetadataWatcher'
import { BrowserPtySocketLifecycle, type BrowserPtySocketLease } from './BrowserPtySocketLifecycle'
import { BrowserPtySessionAuthority } from './BrowserPtySessionAuthority'
import { BrowserPtyClientStateReplay } from './BrowserPtyClientStateReplay'
import { BrowserPtyClientAgentReexec } from './BrowserPtyClientAgentReexec'
import { parseBrowserPtyMetadata } from './BrowserPtyMetadata'
import {
  emitBrowserPtyEvent,
  normalizeBrowserPtyPositiveInt,
  normalizeBrowserPtySessionState,
  normalizeBrowserPtyStateMetadata,
} from './BrowserPtyWire'

type UnsubscribeFn = () => void

export class BrowserPtyClient {
  private readonly sessionAuthority = new BrowserPtySessionAuthority()
  private readonly attachedSessions = this.sessionAuthority.sessions
  private readonly geometryAcks = new BrowserPtyGeometryAckCoordinator()
  private readonly socketLifecycle = new BrowserPtySocketLifecycle({
    onConnected: (lease, send) => {
      send({
        type: 'hello',
        protocolVersion: 1,
        client: { kind: 'web', version: null },
      })
      this.sessionAuthority.onConnected(lease, send)
    },
    onMessage: (lease, raw) => {
      void this.handleMessage(lease, raw)
    },
    onDisconnected: (lease, error) => {
      this.sessionAuthority.retireLease(lease, error)
      this.agentReexec.rejectAll(error)
      this.geometryAcks.rejectAll(error)
    },
    shouldReconnect: () => this.attachedSessions.size > 0,
  })
  private readonly agentReexec = new BrowserPtyClientAgentReexec()
  private readonly dataListeners = new Set<(event: TerminalDataEvent) => void>()
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>()
  private readonly geometryListeners = new Set<(event: TerminalGeometryEvent) => void>()
  private readonly resyncListeners = new Set<(event: TerminalResyncEvent) => void>()
  private readonly stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  private readonly metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  private readonly stateReplay = new BrowserPtyClientStateReplay()
  private readonly latestMetadataBySessionId = new Map<string, TerminalSessionMetadataEvent>()
  private readonly metadataWatcher = new BrowserPtyClientMetadataWatcher({
    hasListeners: () => this.metadataListeners.size > 0,
    emit: event => {
      this.latestMetadataBySessionId.set(event.sessionId, event)
      emitBrowserPtyEvent(this.metadataListeners, event)
    },
  })
  private async handleMessage(lease: BrowserPtySocketLease, raw: string): Promise<void> {
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

    if (type === 'hello_ack') {
      this.sessionAuthority.noteHelloAck(lease)
      this.agentReexec.noteHelloAck(record)
      this.geometryAcks.noteHelloAck(record)
      return
    }

    if (!type || !sessionId) {
      return
    }

    if (type === 'attached') {
      this.sessionAuthority.noteAttached(lease, record)
      return
    }

    if (type === 'control_changed') {
      this.sessionAuthority.noteControlChanged(lease, sessionId, record)
      return
    }

    if (type === 'agent_reexec_result') {
      this.agentReexec.handleResult(record)
      return
    }

    if (type === 'resize_result') {
      const result = this.geometryAcks.resolveTyped(record)
      if (!result) {
        return
      }
      if (result.authority) {
        const state = this.attachedSessions.get(sessionId)
        if (state) {
          state.role = result.authority.role
          state.authorityEpoch = result.authority.epoch
        }
      }
      return
    }

    if (type === 'error') {
      const message = typeof record.message === 'string' ? record.message : 'PTY resize failed'
      this.geometryAcks.rejectLegacySession(sessionId, message)
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
      emitBrowserPtyEvent(this.dataListeners, { sessionId, data, seq })
      return
    }

    if (type === 'exit') {
      const exitCode =
        typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
          ? Math.floor(record.exitCode)
          : 0
      this.stateReplay.disposeSession(sessionId)
      this.sessionAuthority.remove(sessionId, new Error('Terminal session exited'))
      this.agentReexec.rejectSession(sessionId, new Error('Terminal session exited'))
      this.latestMetadataBySessionId.delete(sessionId)
      this.metadataWatcher.cancel(sessionId)
      emitBrowserPtyEvent(this.exitListeners, { sessionId, exitCode })
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
      const revision = normalizeBrowserPtyPositiveInt(record.revision)
      const state = this.attachedSessions.get(sessionId)
      if (state && revision !== null) {
        state.nextLegacyRevision = Math.max(state.nextLegacyRevision, revision)
      }

      if (cols <= 0 || rows <= 0 || !reason) {
        return
      }

      emitBrowserPtyEvent(this.geometryListeners, {
        sessionId,
        cols,
        rows,
        reason,
        ...(revision !== null ? { revision } : {}),
      })
      if (revision !== null) {
        this.geometryAcks.resolveLegacyGeometry({
          sessionId,
          cols,
          rows,
          revision,
          authority:
            state && state.authorityEpoch !== null
              ? { role: state.role, epoch: state.authorityEpoch }
              : null,
        })
      }
      return
    }

    if (type === 'state') {
      const state = normalizeBrowserPtySessionState(record.state)
      if (!state) {
        return
      }

      const eventPayload: TerminalSessionStateEvent = { sessionId, state }
      Object.assign(eventPayload, normalizeBrowserPtyStateMetadata(record))
      this.stateReplay.register(eventPayload)
      emitBrowserPtyEvent(this.stateListeners, eventPayload)
      return
    }

    if (type === 'metadata') {
      const eventPayload = parseBrowserPtyMetadata(sessionId, record)
      this.latestMetadataBySessionId.set(sessionId, eventPayload)
      emitBrowserPtyEvent(this.metadataListeners, eventPayload)
      this.metadataWatcher.cancel(sessionId)
      return
    }

    if (type === 'overflow') {
      const reason = record.reason === 'replay_window_exceeded' ? record.reason : null
      const recovery = record.recovery === 'presentation_snapshot' ? record.recovery : null

      if (!reason || !recovery) {
        return
      }

      emitBrowserPtyEvent(this.resyncListeners, {
        sessionId,
        reason,
        recovery,
      })
      return
    }
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
    const attached = await this.sessionAuthority.ensureAttached(
      this.socketLifecycle,
      payload.sessionId,
    )
    if (
      !this.socketLifecycle.sendIfCurrent(attached.lease, {
        type: 'write',
        sessionId: payload.sessionId,
        data: payload.data,
      })
    ) {
      throw new Error('PTY stream socket changed before write')
    }
  }

  public async reexecAgent(payload: TerminalAgentReexecInput): Promise<TerminalAgentReexecResult> {
    const attached = await this.sessionAuthority.ensureAttached(
      this.socketLifecycle,
      payload.sessionId,
    )
    return await this.agentReexec.reexec({
      input: payload,
      authorityEpoch: attached.result.authority.epoch,
      send: async message => {
        if (!this.socketLifecycle.sendIfCurrent(attached.lease, message)) {
          throw new Error('PTY stream socket changed before terminal Agent re-exec')
        }
      },
    })
  }

  public async resize(payload: ResizeTerminalInput): Promise<TerminalGeometryCommitResult> {
    const attached = await this.sessionAuthority.ensureAttached(
      this.socketLifecycle,
      payload.sessionId,
    )
    const state = this.attachedSessions.get(payload.sessionId)
    const legacyRevision =
      this.geometryAcks.typedAckSupported === false && state
        ? (state.nextLegacyRevision += 1)
        : null
    const pending = this.geometryAcks.begin({
      sessionId: payload.sessionId,
      operationId: payload.operationId,
      legacyRevision,
    })

    try {
      if (
        !this.socketLifecycle.sendIfCurrent(attached.lease, {
          type: 'resize',
          sessionId: payload.sessionId,
          cols: payload.cols,
          rows: payload.rows,
          reason: payload.reason,
          operationId: pending.operationId,
          ...(payload.baseGeometryRevision !== undefined
            ? { baseGeometryRevision: payload.baseGeometryRevision }
            : {}),
          authorityEpoch: attached.result.authority.epoch,
          ...(legacyRevision !== null
            ? { revision: legacyRevision }
            : typeof payload.revision === 'number' && Number.isFinite(payload.revision)
              ? { revision: payload.revision }
              : {}),
        })
      ) {
        throw new Error('PTY stream socket changed before terminal geometry commit')
      }
    } catch (error) {
      this.geometryAcks.reject(
        payload.sessionId,
        pending.operationId,
        error instanceof Error ? error : new Error(String(error)),
      )
    }

    return await pending.result
  }

  public async kill(payload: KillTerminalInput): Promise<void> {
    await invokeBrowserControlSurface<void>({
      kind: 'command',
      id: 'session.kill',
      payload: { sessionId: payload.sessionId },
    })
  }

  public async attach(payload: AttachTerminalInput): Promise<AttachTerminalResult> {
    this.sessionAuthority.track(payload)
    const attached = await this.sessionAuthority.ensureAttached(
      this.socketLifecycle,
      payload.sessionId,
    )
    this.metadataWatcher.ensure(payload.sessionId)
    return attached.result
  }

  public async detach(payload: DetachTerminalInput): Promise<void> {
    this.sessionAuthority.remove(payload.sessionId, new Error('Terminal session detached'))
    this.agentReexec.rejectSession(payload.sessionId, new Error('Terminal session detached'))
    this.stateReplay.disposeSession(payload.sessionId)
    this.latestMetadataBySessionId.delete(payload.sessionId)
    this.metadataWatcher.cancel(payload.sessionId)
    this.socketLifecycle.sendIfOpen({
      type: 'detach',
      sessionId: payload.sessionId,
    })
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
      existing.nextLegacyRevision = Math.max(
        existing.nextLegacyRevision,
        snapshot.geometryRevision ?? 0,
      )
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
    this.stateReplay.replay(listener)
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
