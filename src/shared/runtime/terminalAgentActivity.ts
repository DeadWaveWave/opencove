import type { TerminalAgentActivityMetadata, TerminalAgentActivitySnapshot } from '../contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeTerminalAgentActivitySnapshot(
  value: unknown,
): TerminalAgentActivitySnapshot | null {
  if (!isRecord(value)) {
    return null
  }
  const provider = value.provider
  const invocationId = typeof value.invocationId === 'string' ? value.invocationId.trim() : ''
  const generation = value.generation
  const phase = value.phase
  const observedAtMs = value.observedAtMs
  const identityAuthority = value.identityAuthority
  const hasSourceRevision = value.sourceRevision !== undefined
  const hasRevision = value.revision !== undefined
  const sourceRevision = value.sourceRevision
  const revision = value.revision
  if (
    (provider !== 'claude-code' && provider !== 'codex' && provider !== 'pi') ||
    invocationId.length === 0 ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    (phase !== 'active' && phase !== 'exited') ||
    typeof observedAtMs !== 'number' ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < 0 ||
    (identityAuthority !== null &&
      identityAuthority !== 'provider_session_start' &&
      !(
        provider === 'pi' &&
        identityAuthority === 'provider_session_snapshot' &&
        hasSourceRevision
      )) ||
    hasSourceRevision !== hasRevision ||
    (hasSourceRevision && (!isRevision(sourceRevision) || !isRevision(revision)))
  ) {
    return null
  }

  return {
    provider,
    invocationId,
    generation,
    phase,
    observedAtMs,
    identityAuthority,
    ...(hasSourceRevision
      ? { sourceRevision: sourceRevision as number, revision: revision as number }
      : {}),
  }
}

export function normalizeTerminalAgentActivityMetadata(
  value: unknown,
): TerminalAgentActivityMetadata | null {
  if (!isRecord(value)) {
    return null
  }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
  const resumeSessionId =
    value.resumeSessionId === null
      ? null
      : typeof value.resumeSessionId === 'string'
        ? value.resumeSessionId.trim()
        : undefined
  const terminalAgentActivity = normalizeTerminalAgentActivitySnapshot(value.terminalAgentActivity)
  if (
    sessionId.length === 0 ||
    resumeSessionId === undefined ||
    (typeof resumeSessionId === 'string' && resumeSessionId.length === 0) ||
    !terminalAgentActivity
  ) {
    return null
  }
  return { sessionId, resumeSessionId, terminalAgentActivity }
}

export function isTerminalAgentActivityStrictlyNewer(
  incoming: TerminalAgentActivitySnapshot,
  current: TerminalAgentActivitySnapshot,
): boolean {
  if (incoming.generation !== current.generation) {
    return incoming.generation > current.generation
  }
  if (
    incoming.provider !== current.provider ||
    incoming.invocationId !== current.invocationId ||
    current.phase === 'exited'
  ) {
    return false
  }
  if (current.revision !== undefined) {
    return incoming.revision !== undefined && incoming.revision > current.revision
  }
  if (incoming.revision !== undefined) {
    return true
  }
  return incoming.observedAtMs > current.observedAtMs
}

export function sameTerminalAgentActivitySnapshot(
  left: TerminalAgentActivitySnapshot | null | undefined,
  right: TerminalAgentActivitySnapshot | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    left.provider === right.provider &&
    left.invocationId === right.invocationId &&
    left.generation === right.generation &&
    left.phase === right.phase &&
    left.observedAtMs === right.observedAtMs &&
    left.identityAuthority === right.identityAuthority &&
    left.sourceRevision === right.sourceRevision &&
    left.revision === right.revision
  )
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
