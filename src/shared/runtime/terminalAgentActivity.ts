import type { TerminalAgentActivitySnapshot } from '../contracts/dto'

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
  if (
    (provider !== 'claude-code' && provider !== 'codex') ||
    invocationId.length === 0 ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    (phase !== 'active' && phase !== 'exited') ||
    typeof observedAtMs !== 'number' ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < 0 ||
    (identityAuthority !== null && identityAuthority !== 'provider_session_start')
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
  }
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
    left.identityAuthority === right.identityAuthority
  )
}
