import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalGeometryEvent,
  TerminalGeometryCommitResult,
  TerminalResyncEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'

export type AttachedSessionState = {
  lastSeq: number
  role: 'viewer' | 'controller'
  authorityEpoch: number | null
}

type PtyStreamMessage =
  | { type: 'hello_ack'; protocolVersion: number; capabilities?: unknown }
  | { type: 'attached'; sessionId: string; seq?: number; role?: string; authorityEpoch?: number }
  | { type: 'data'; sessionId: string; seq?: number; data?: string }
  | { type: 'exit'; sessionId: string; seq?: number; exitCode?: number }
  | {
      type: 'geometry'
      sessionId: string
      cols?: number
      rows?: number
      reason?: string
      revision?: number
    }
  | { type: 'state'; sessionId: string; state?: string }
  | {
      type: 'metadata'
      sessionId: string
      resumeSessionId?: string | null
      profileId?: string | null
      runtimeKind?: string | null
    }
  | {
      type: 'overflow'
      sessionId: string
      seq?: number
      reason?: string
      recovery?: string
    }
  | { type: 'control_changed'; sessionId: string; role?: string; authorityEpoch?: number }
  | ({ type: 'resize_result' } & Record<string, unknown>)
  | { type: 'error'; code?: string; message?: string; sessionId?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.floor(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalRawString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeTerminalSessionState(value: unknown): 'working' | 'standby' | null {
  if (value === 'working' || value === 'standby') {
    return value
  }

  return null
}

export function parseTerminalGeometryCommitResult(
  record: Record<string, unknown>,
): TerminalGeometryCommitResult | null {
  const sessionId = normalizeOptionalString(record.sessionId)
  const operationId = normalizeOptionalString(record.operationId)
  const status =
    record.status === 'accepted' ||
    record.status === 'rejected_not_controller' ||
    record.status === 'rejected_stale_authority' ||
    record.status === 'superseded' ||
    record.status === 'session_not_found' ||
    record.status === 'runtime_failed'
      ? record.status
      : null
  if (!sessionId || !operationId || !status) {
    return null
  }
  const rawGeometry = isRecord(record.geometry)
    ? (record.geometry as Record<string, unknown>)
    : null
  const cols = normalizeOptionalFiniteInt(rawGeometry?.cols)
  const rows = normalizeOptionalFiniteInt(rawGeometry?.rows)
  const rawRevision = rawGeometry?.revision
  const revision = rawRevision === null ? null : normalizeOptionalFiniteInt(rawRevision)
  const geometry =
    rawGeometry && cols !== null && cols > 0 && rows !== null && rows > 0
      ? { cols, rows, revision: revision !== null && revision > 0 ? revision : null }
      : null
  const rawAuthority = isRecord(record.authority)
    ? (record.authority as Record<string, unknown>)
    : null
  const role =
    rawAuthority?.role === 'controller' || rawAuthority?.role === 'viewer'
      ? rawAuthority.role
      : null
  const epoch = normalizeOptionalFiniteInt(rawAuthority?.epoch)
  return {
    sessionId,
    operationId,
    status,
    changed: record.changed === true,
    geometry,
    authority: role && epoch !== null && epoch >= 0 ? { role, epoch } : null,
  }
}

export function createRemotePtyStreamMessageHandler(options: {
  attachedSessions: Map<string, AttachedSessionState>
  sendToSessionSubscribers: (sessionId: string, channel: string, payload: unknown) => void
  sendToAllWindows: (channel: string, payload: unknown) => void
  externalDataListeners: Set<(event: TerminalDataEvent) => void>
  externalExitListeners: Set<(event: { sessionId: string; exitCode: number }) => void>
  externalStateListeners: Set<(event: TerminalSessionStateEvent) => void>
  externalMetadataListeners: Set<(event: TerminalSessionMetadataEvent) => void>
  cancelMetadataWatcher: (sessionId: string) => void
  onSessionExit: (sessionId: string) => void
  onSessionAttached: (sessionId: string) => void
  handshake: {
    onHelloAck: (capabilities: { geometryCommitAck: boolean }) => void
    onHandshakeError: (error: Error) => void
  }
  onResizeResult: (result: TerminalGeometryCommitResult) => void
  onGeometry: (event: TerminalGeometryEvent) => void
  onAuthorityChanged: (
    sessionId: string,
    authority: { role: 'viewer' | 'controller'; epoch: number },
  ) => void
  onSessionError: (sessionId: string, code: string | null, message: string) => void
}): (raw: string) => void {
  return (raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return
    }

    const message = parsed as PtyStreamMessage

    if (message.type === 'hello_ack') {
      const capabilities = isRecord(message.capabilities)
        ? (message.capabilities as Record<string, unknown>)
        : null
      options.handshake.onHelloAck({ geometryCommitAck: capabilities?.geometryCommitAck === 1 })
      return
    }

    if (message.type === 'error') {
      const errorMessage =
        normalizeOptionalString(message.message) ??
        normalizeOptionalString(message.code) ??
        'PTY error'
      const errorSessionId = normalizeOptionalString(message.sessionId)
      if (errorSessionId) {
        options.onSessionError(errorSessionId, normalizeOptionalString(message.code), errorMessage)
      } else {
        options.handshake.onHandshakeError(new Error(errorMessage))
      }
      return
    }

    const sessionId = normalizeOptionalString(message.sessionId)
    if (!sessionId) {
      return
    }

    if (message.type === 'attached') {
      if (!options.attachedSessions.has(sessionId)) {
        options.attachedSessions.set(sessionId, {
          lastSeq: 0,
          role: 'viewer',
          authorityEpoch: null,
        })
      }
      const state = options.attachedSessions.get(sessionId)
      if (state) {
        state.role = message.role === 'controller' ? 'controller' : 'viewer'
        state.authorityEpoch = Math.max(0, normalizeOptionalFiniteInt(message.authorityEpoch) ?? 0)
        options.onAuthorityChanged(sessionId, {
          role: state.role,
          epoch: state.authorityEpoch,
        })
      }
      options.onSessionAttached(sessionId)
      return
    }

    if (message.type === 'control_changed') {
      const state = options.attachedSessions.get(sessionId)
      if (!state) {
        return
      }
      state.role = message.role === 'controller' ? 'controller' : 'viewer'
      state.authorityEpoch = Math.max(0, normalizeOptionalFiniteInt(message.authorityEpoch) ?? 0)
      options.onAuthorityChanged(sessionId, {
        role: state.role,
        epoch: state.authorityEpoch,
      })
      return
    }

    if (message.type === 'resize_result') {
      const result = parseTerminalGeometryCommitResult(message)
      if (result) {
        options.onResizeResult(result)
      }
      return
    }

    if (message.type === 'data') {
      const data = normalizeOptionalRawString(message.data) ?? ''
      const seq = normalizeOptionalFiniteInt(message.seq) ?? 0
      const existing = options.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      if (data.length > 0) {
        options.sendToSessionSubscribers(sessionId, IPC_CHANNELS.ptyData, {
          sessionId,
          data,
          seq,
        } satisfies TerminalDataEvent)
        options.externalDataListeners.forEach(listener => listener({ sessionId, data, seq }))
      }
      return
    }

    if (message.type === 'exit') {
      const exitCode = normalizeOptionalFiniteInt(message.exitCode) ?? 0
      const seq = normalizeOptionalFiniteInt(message.seq) ?? 0
      const existing = options.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      const eventPayload: TerminalExitEvent = {
        sessionId,
        exitCode,
      }
      options.sendToAllWindows(IPC_CHANNELS.ptyExit, eventPayload)
      options.externalExitListeners.forEach(listener => listener(eventPayload))
      options.onSessionExit(sessionId)
      return
    }

    if (message.type === 'geometry') {
      const cols = normalizeOptionalFiniteInt(message.cols) ?? 0
      const rows = normalizeOptionalFiniteInt(message.rows) ?? 0
      const reason =
        message.reason === 'frame_commit' || message.reason === 'appearance_commit'
          ? message.reason
          : null
      const revision = normalizeOptionalFiniteInt(message.revision)

      if (cols <= 0 || rows <= 0 || !reason) {
        return
      }

      const eventPayload: TerminalGeometryEvent = {
        sessionId,
        cols,
        rows,
        reason,
        ...(revision !== null && revision > 0 ? { revision } : {}),
      }
      options.sendToAllWindows(IPC_CHANNELS.ptyGeometry, eventPayload)
      options.onGeometry(eventPayload)
      return
    }

    if (message.type === 'state') {
      const state = normalizeTerminalSessionState(message.state)
      if (!state) {
        return
      }

      const eventPayload: TerminalSessionStateEvent = { sessionId, state }
      options.sendToAllWindows(IPC_CHANNELS.ptyState, eventPayload)
      options.externalStateListeners.forEach(listener => listener(eventPayload))
      return
    }

    if (message.type === 'metadata') {
      const resumeSessionId =
        typeof message.resumeSessionId === 'string' && message.resumeSessionId.trim().length > 0
          ? message.resumeSessionId.trim()
          : null
      const profileId =
        typeof message.profileId === 'string' && message.profileId.trim().length > 0
          ? message.profileId.trim()
          : null
      const runtimeKind =
        message.runtimeKind === 'windows' ||
        message.runtimeKind === 'wsl' ||
        message.runtimeKind === 'posix'
          ? message.runtimeKind
          : null

      const eventPayload: TerminalSessionMetadataEvent = {
        sessionId,
        resumeSessionId,
        ...(profileId ? { profileId } : {}),
        ...(runtimeKind ? { runtimeKind } : {}),
      }
      options.sendToAllWindows(IPC_CHANNELS.ptySessionMetadata, eventPayload)
      options.externalMetadataListeners.forEach(listener => listener(eventPayload))
      options.cancelMetadataWatcher(sessionId)
      return
    }

    if (message.type === 'overflow') {
      options.sendToAllWindows(IPC_CHANNELS.ptyResync, {
        sessionId,
        reason: 'replay_window_exceeded',
        recovery: 'presentation_snapshot',
      } satisfies TerminalResyncEvent)
    }
  }
}
