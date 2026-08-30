import type {
  TerminalGeometryCommitResult,
  TerminalForegroundEvent,
  TerminalAgentReexecResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import {
  parseTerminalForegroundEvent,
  parseTerminalGeometryCommitResult,
} from '../remote/remotePtyStreamMessageHandler'
import { normalizeTerminalAgentActivitySnapshot } from '../../../../shared/runtime/terminalAgentActivity'
import { normalizeTerminalAgentReexecResult } from '../../../../shared/runtime/terminalAgentReexec'

export type RemotePtyEndpointAttachedSessionState = {
  lastSeq: number
  role: 'viewer' | 'controller'
  authorityEpoch: number | null
}

export function createRemotePtyEndpointAttachedSessionState(): RemotePtyEndpointAttachedSessionState {
  return { lastSeq: 0, role: 'viewer', authorityEpoch: null }
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

function normalizeOptionalRawString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function createRemotePtyEndpointProxyMessageHandler(options: {
  attachedSessions: Map<string, RemotePtyEndpointAttachedSessionState>
  onHelloAck: (result: {
    agentReexecSupported: boolean
    geometryCommitAckSupported: boolean
    serverInstanceId: string | null
  }) => void
  onAgentReexecResult: (result: TerminalAgentReexecResult) => void
  onError: (input: { sessionId: string | null; message: string }) => void
  onResizeResult: (result: TerminalGeometryCommitResult) => void
  onData: (sessionId: string, data: string, seq: number) => void
  onExit: (sessionId: string, exitCode: number, seq: number) => void
  onForeground: (sessionId: string, event: TerminalForegroundEvent) => void
  onOverflow: (sessionId: string) => void
  onState: (sessionId: string, event: TerminalSessionStateEvent) => void
  onMetadata: (sessionId: string, metadata: TerminalSessionMetadataEvent) => void
}): (raw: string) => void {
  return raw => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return
    }

    if (parsed.type === 'hello_ack') {
      const capabilities = isRecord(parsed.capabilities)
        ? (parsed.capabilities as Record<string, unknown>)
        : null
      options.onHelloAck({
        agentReexecSupported: capabilities?.agentReexec === 1,
        geometryCommitAckSupported: capabilities?.geometryCommitAck === 1,
        serverInstanceId: isRecord(parsed.server)
          ? normalizeOptionalRawString(parsed.server.instanceId)
          : null,
      })
      return
    }

    if (parsed.type === 'error') {
      options.onError({
        sessionId: normalizeOptionalRawString(parsed.sessionId),
        message: normalizeOptionalRawString(parsed.message) ?? 'PTY error',
      })
      return
    }

    const sessionId = normalizeOptionalRawString(parsed.sessionId)
    if (!sessionId) {
      return
    }

    if (parsed.type === 'attached') {
      if (!options.attachedSessions.has(sessionId)) {
        options.attachedSessions.set(sessionId, createRemotePtyEndpointAttachedSessionState())
      }
      const state = options.attachedSessions.get(sessionId)
      if (state) {
        state.role = parsed.role === 'controller' ? 'controller' : 'viewer'
        state.authorityEpoch = Math.max(0, normalizeOptionalFiniteInt(parsed.authorityEpoch) ?? 0)
      }
      return
    }

    if (parsed.type === 'control_changed') {
      const state = options.attachedSessions.get(sessionId)
      if (state) {
        state.role = parsed.role === 'controller' ? 'controller' : 'viewer'
        state.authorityEpoch = Math.max(0, normalizeOptionalFiniteInt(parsed.authorityEpoch) ?? 0)
      }
      return
    }

    if (parsed.type === 'resize_result') {
      const result = parseTerminalGeometryCommitResult(parsed)
      if (result) {
        options.onResizeResult(result)
      }
      return
    }

    if (parsed.type === 'agent_reexec_result') {
      const result = normalizeTerminalAgentReexecResult(parsed)
      if (result) {
        options.onAgentReexecResult(result)
      }
      return
    }

    if (parsed.type === 'data') {
      const data = normalizeOptionalRawString(parsed.data) ?? ''
      const seq = normalizeOptionalFiniteInt(parsed.seq) ?? 0
      if (data.length > 0) {
        options.onData(sessionId, data, seq)
      }
      return
    }

    if (parsed.type === 'exit') {
      const exitCode = normalizeOptionalFiniteInt(parsed.exitCode) ?? 0
      const seq = normalizeOptionalFiniteInt(parsed.seq) ?? 0
      options.onExit(sessionId, exitCode, seq)
      return
    }

    if (parsed.type === 'foreground') {
      const event = parseTerminalForegroundEvent(parsed)
      if (event) {
        options.onForeground(sessionId, event)
      }
      return
    }

    if (parsed.type === 'overflow') {
      options.onOverflow(sessionId)
      return
    }

    if (parsed.type === 'state') {
      const state =
        parsed.state === 'working' || parsed.state === 'waiting' || parsed.state === 'standby'
          ? parsed.state
          : null
      if (!state) {
        return
      }
      const source =
        parsed.source === 'launch' ||
        parsed.source === 'session_file' ||
        parsed.source === 'claude_hook' ||
        parsed.source === 'codex_hook'
          ? parsed.source
          : null
      const hookInstallState =
        parsed.hookInstallState === 'installed' ||
        parsed.hookInstallState === 'partial' ||
        parsed.hookInstallState === 'not_installed' ||
        parsed.hookInstallState === 'error' ||
        parsed.hookInstallState === 'skipped'
          ? parsed.hookInstallState
          : null
      const observedAtMs =
        typeof parsed.observedAtMs === 'number' &&
        Number.isFinite(parsed.observedAtMs) &&
        parsed.observedAtMs >= 0
          ? parsed.observedAtMs
          : null
      options.onState(sessionId, {
        sessionId,
        state,
        ...(source ? { source } : {}),
        ...(hookInstallState ? { hookInstallState } : {}),
        ...(typeof parsed.degraded === 'boolean' ? { degraded: parsed.degraded } : {}),
        ...(observedAtMs !== null ? { observedAtMs } : {}),
      })
      return
    }

    if (parsed.type === 'metadata') {
      const resumeSessionId =
        typeof parsed.resumeSessionId === 'string' && parsed.resumeSessionId.trim().length > 0
          ? parsed.resumeSessionId.trim()
          : null
      const agentProvider =
        parsed.agentProvider === 'claude-code' ||
        parsed.agentProvider === 'codex' ||
        parsed.agentProvider === 'opencode' ||
        parsed.agentProvider === 'gemini' ||
        parsed.agentProvider === 'pi' ||
        parsed.agentProvider === 'kimi'
          ? parsed.agentProvider
          : null
      const profileId =
        typeof parsed.profileId === 'string' && parsed.profileId.trim().length > 0
          ? parsed.profileId.trim()
          : null
      const runtimeKind =
        parsed.runtimeKind === 'windows' ||
        parsed.runtimeKind === 'wsl' ||
        parsed.runtimeKind === 'posix'
          ? parsed.runtimeKind
          : null
      const terminalAgentActivity = normalizeTerminalAgentActivitySnapshot(
        parsed.terminalAgentActivity,
      )
      options.onMetadata(sessionId, {
        sessionId,
        resumeSessionId,
        ...(agentProvider ? { agentProvider } : {}),
        ...(profileId ? { profileId } : {}),
        ...(runtimeKind ? { runtimeKind } : {}),
        ...(terminalAgentActivity ? { terminalAgentActivity } : {}),
      })
    }
  }
}
