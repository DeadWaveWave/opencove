import type { PiAgentSnapshot } from '../contracts/dto/piAgentSnapshot'

export function normalizePiAgentSnapshot(value: unknown): PiAgentSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const input = value as Record<string, unknown>
  const {
    version,
    pid,
    sequence,
    conversationRevision,
    sessionId,
    sessionFile,
    persistence,
    state,
  } = input
  if (
    version !== 1 ||
    !isPositiveInteger(pid) ||
    !isPositiveInteger(sequence) ||
    !isPositiveInteger(conversationRevision) ||
    conversationRevision > sequence ||
    !isIdentifier(sessionId) ||
    (state !== 'working' && state !== 'waiting' && state !== 'standby') ||
    (persistence !== 'allocated' && persistence !== 'resumable' && persistence !== 'ephemeral')
  ) {
    return null
  }
  if (persistence === 'ephemeral') {
    if (sessionFile !== null) {
      return null
    }
  } else if (!isIdentifier(sessionFile) || !isAbsoluteSessionPath(sessionFile)) {
    return null
  }
  return {
    version,
    pid,
    sequence,
    conversationRevision,
    sessionId,
    sessionFile: sessionFile as string | null,
    persistence,
    state,
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  )
}

function isAbsoluteSessionPath(value: string): boolean {
  // This boundary is shared with remote Windows workers; host path.isAbsolute is insufficient.
  return value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')
}
