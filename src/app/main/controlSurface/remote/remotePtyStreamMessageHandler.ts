import type { PtyStreamMessage } from './remotePtyStreamMessage'
import { normalizePiStateObservationMetadata } from '../../../../shared/runtime/piConversation'
import { normalizePiAgentSnapshot } from '../../../../shared/runtime/piAgentSnapshot'
import { isAgentHookStateSource } from '../../../../shared/runtime/agentHookStateSource'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalForegroundEvent,
  TerminalGeometryEvent,
  TerminalGeometryCommitResult,
  TerminalGeometryAuthority,
  TerminalAgentReexecResult,
  TerminalResyncEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import { normalizeTerminalAgentActivitySnapshot } from '../../../../shared/runtime/terminalAgentActivity'
import { normalizeTerminalAgentReexecResult } from '../../../../shared/runtime/terminalAgentReexec'
import { normalizeRemotePtyAuthority } from './remotePtyAuthority'

export type AttachedSessionState = {
  lastSeq: number
  role: 'viewer' | 'controller'
  authorityEpoch: number | null
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

function normalizeTerminalSessionState(value: unknown): 'working' | 'waiting' | 'standby' | null {
  if (value === 'working' || value === 'waiting' || value === 'standby') {
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
    record.status === 'accepted_unverified' ||
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
    status: status === 'accepted' && geometry === null ? 'runtime_failed' : status,
    changed: status === 'accepted' && geometry === null ? false : record.changed === true,
    geometry,
    authority: role && epoch !== null && epoch >= 0 ? { role, epoch } : null,
  }
}

export function parseTerminalForegroundEvent(
  record: Record<string, unknown>,
): TerminalForegroundEvent | null {
  const sessionId = normalizeOptionalString(record.sessionId)
  const observedAtMs = normalizeOptionalFiniteInt(record.observedAtMs)
  const source =
    record.source === 'process_scan' ||
    record.source === 'windows_exit_code' ||
    record.source === 'windows_prompt_timeout'
      ? record.source
      : null
  const availability =
    record.availability === 'available' || record.availability === 'unavailable'
      ? record.availability
      : null
  const agent = record.agent === 'codex' || record.agent === null ? record.agent : undefined
  const exitCode = record.exitCode === null ? null : normalizeOptionalFiniteInt(record.exitCode)
  if (
    !sessionId ||
    observedAtMs === null ||
    observedAtMs < 0 ||
    !source ||
    !availability ||
    agent === undefined ||
    typeof record.shellOnly !== 'boolean' ||
    (record.exitCode !== null && exitCode === null)
  ) {
    return null
  }

  const base = {
    sessionId,
    observedAtMs,
  }
  if (source === 'process_scan' && exitCode === null) {
    if (availability === 'available') {
      return { ...base, source, exitCode, availability, agent, shellOnly: record.shellOnly }
    }
    if (agent === null && record.shellOnly === false) {
      return { ...base, source, exitCode, availability, agent, shellOnly: false }
    }
  }
  if (
    source === 'windows_exit_code' &&
    exitCode !== null &&
    availability === 'unavailable' &&
    agent === null &&
    record.shellOnly === false
  ) {
    return { ...base, source, exitCode, availability, agent, shellOnly: false }
  }
  if (
    source === 'windows_prompt_timeout' &&
    exitCode === null &&
    availability === 'unavailable' &&
    agent === null &&
    record.shellOnly === false
  ) {
    return { ...base, source, exitCode, availability, agent, shellOnly: false }
  }
  return null
}

export function createRemotePtyStreamMessageHandler(options: {
  attachedSessions: Map<string, AttachedSessionState>
  sendToSessionSubscribers: (sessionId: string, channel: string, payload: unknown) => void
  sendToAllWindows: (channel: string, payload: unknown) => void
  externalDataListeners: Set<(event: TerminalDataEvent) => void>
  externalExitListeners: Set<(event: { sessionId: string; exitCode: number }) => void>
  externalForegroundListeners: Set<(event: TerminalForegroundEvent) => void>
  externalStateListeners: Set<(event: TerminalSessionStateEvent) => void>
  externalMetadataListeners: Set<(event: TerminalSessionMetadataEvent) => void>
  onSessionState: (event: TerminalSessionStateEvent) => void
  cancelMetadataWatcher: (sessionId: string) => void
  onSessionExit: (sessionId: string) => void
  onSessionAttached: (sessionId: string, authority: TerminalGeometryAuthority) => void
  handshake: {
    onHelloAck: (capabilities: { agentReexec: boolean; geometryCommitAck: boolean }) => void
    onHandshakeError: (error: Error) => void
  }
  onResizeResult: (result: TerminalGeometryCommitResult) => void
  onAgentReexecResult: (result: TerminalAgentReexecResult) => void
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
      options.handshake.onHelloAck({
        agentReexec: capabilities?.agentReexec === 1,
        geometryCommitAck: capabilities?.geometryCommitAck === 1,
      })
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
      const authority = normalizeRemotePtyAuthority(message.role, message.authorityEpoch)
      if (!authority) {
        return
      }
      const state = options.attachedSessions.get(sessionId) ?? {
        lastSeq: 0,
        role: 'viewer' as const,
        authorityEpoch: null,
      }
      state.role = authority.role
      state.authorityEpoch = authority.epoch
      options.attachedSessions.set(sessionId, state)
      options.onAuthorityChanged(sessionId, authority)
      options.onSessionAttached(sessionId, authority)
      return
    }

    if (message.type === 'control_changed') {
      const state = options.attachedSessions.get(sessionId)
      const authority = normalizeRemotePtyAuthority(message.role, message.authorityEpoch)
      if (!state || !authority) {
        return
      }
      state.role = authority.role
      state.authorityEpoch = authority.epoch
      options.onAuthorityChanged(sessionId, authority)
      return
    }

    if (message.type === 'resize_result') {
      const result = parseTerminalGeometryCommitResult(message)
      if (result) {
        options.onResizeResult(result)
      }
      return
    }

    if (message.type === 'agent_reexec_result') {
      const result = normalizeTerminalAgentReexecResult(message)
      if (result) {
        options.onAgentReexecResult(result)
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

    if (message.type === 'foreground') {
      const eventPayload = parseTerminalForegroundEvent(message)
      if (!eventPayload) {
        return
      }
      options.sendToAllWindows(IPC_CHANNELS.ptyForeground, eventPayload)
      options.externalForegroundListeners.forEach(listener => listener(eventPayload))
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

      const eventPayload: TerminalSessionStateEvent = {
        sessionId,
        state,
        ...normalizePiStateObservationMetadata(message),
      }
      if (
        message.source === 'launch' ||
        message.source === 'session_file' ||
        isAgentHookStateSource(message.source)
      ) {
        eventPayload.source = message.source
      }
      if (
        message.hookInstallState === 'installed' ||
        message.hookInstallState === 'partial' ||
        message.hookInstallState === 'not_installed' ||
        message.hookInstallState === 'error' ||
        message.hookInstallState === 'skipped'
      ) {
        eventPayload.hookInstallState = message.hookInstallState
      }
      if (typeof message.degraded === 'boolean') {
        eventPayload.degraded = message.degraded
      }
      if (
        typeof message.observedAtMs === 'number' &&
        Number.isFinite(message.observedAtMs) &&
        message.observedAtMs >= 0
      ) {
        eventPayload.observedAtMs = message.observedAtMs
      }
      options.onSessionState(eventPayload)
      options.sendToAllWindows(IPC_CHANNELS.ptyState, eventPayload)
      options.externalStateListeners.forEach(listener => listener(eventPayload))
      return
    }

    if (message.type === 'metadata') {
      const resumeSessionId =
        typeof message.resumeSessionId === 'string' && message.resumeSessionId.trim().length > 0
          ? message.resumeSessionId.trim()
          : null
      const agentProvider =
        message.agentProvider === 'claude-code' ||
        message.agentProvider === 'codex' ||
        message.agentProvider === 'opencode' ||
        message.agentProvider === 'gemini' ||
        message.agentProvider === 'pi' ||
        message.agentProvider === 'kimi'
          ? message.agentProvider
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
      const piSnapshot = normalizePiAgentSnapshot(message.piSnapshot)
      if (message.piSnapshot !== undefined && (!piSnapshot || agentProvider !== 'pi')) {
        return
      }
      const terminalAgentActivity = normalizeTerminalAgentActivitySnapshot(
        message.terminalAgentActivity,
      )

      const eventPayload: TerminalSessionMetadataEvent = {
        sessionId,
        resumeSessionId,
        ...(agentProvider ? { agentProvider } : {}),
        ...(profileId ? { profileId } : {}),
        ...(runtimeKind ? { runtimeKind } : {}),
        ...(terminalAgentActivity ? { terminalAgentActivity } : {}),
        ...(piSnapshot ? { piSnapshot } : {}),
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
