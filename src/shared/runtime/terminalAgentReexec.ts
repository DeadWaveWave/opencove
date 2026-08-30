import {
  AGENT_PROVIDER_IDS,
  type TerminalAgentActivityFence,
  type TerminalAgentActivitySnapshot,
  type TerminalAgentReexecInput,
  type TerminalAgentReexecResult,
  type TerminalAgentReexecStatus,
} from '../contracts/dto'

const AGENT_PROVIDER_ID_SET = new Set<string>(AGENT_PROVIDER_IDS)
const TERMINAL_AGENT_REEXEC_STATUSES = new Set<TerminalAgentReexecStatus>([
  'reexecuted',
  'drop_back_timeout',
  'rejected_not_controller',
  'rejected_stale_authority',
  'rejected_stale_activity',
  'session_not_found',
  'runtime_failed',
])
const MAX_OPERATION_ID_LENGTH = 160
const MAX_SESSION_ID_LENGTH = 512

export const TERMINAL_AGENT_DROP_BACK_TIMEOUT_MS = 3_000
export const TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeIdentifier(value: unknown, maxLength: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizeActivityFence(value: unknown): TerminalAgentActivityFence | null {
  if (!isRecord(value)) {
    return null
  }
  const provider = value.provider
  const invocationId = normalizeIdentifier(value.invocationId, MAX_SESSION_ID_LENGTH)
  const generation = value.generation
  const phase = value.phase
  const observedAtMs = value.observedAtMs
  const hasSourceRevision = value.sourceRevision !== undefined
  const hasRevision = value.revision !== undefined
  if (
    (provider !== 'claude-code' && provider !== 'codex') ||
    !invocationId ||
    !isPositiveSafeInteger(generation) ||
    (phase !== 'active' && phase !== 'exited') ||
    typeof observedAtMs !== 'number' ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < 0 ||
    hasSourceRevision !== hasRevision ||
    (hasSourceRevision &&
      (!isPositiveSafeInteger(value.sourceRevision) || !isPositiveSafeInteger(value.revision)))
  ) {
    return null
  }
  return {
    provider,
    invocationId,
    generation,
    phase,
    observedAtMs,
    ...(hasSourceRevision
      ? { sourceRevision: value.sourceRevision as number, revision: value.revision as number }
      : {}),
  }
}

export function normalizeTerminalAgentReexecInput(value: unknown): TerminalAgentReexecInput | null {
  if (!isRecord(value)) {
    return null
  }
  const sessionId = normalizeIdentifier(value.sessionId, MAX_SESSION_ID_LENGTH)
  const operationId =
    value.operationId === undefined
      ? undefined
      : normalizeIdentifier(value.operationId, MAX_OPERATION_ID_LENGTH)
  const provider = value.provider
  const resumeSessionId =
    value.resumeSessionId === null
      ? null
      : normalizeIdentifier(value.resumeSessionId, MAX_SESSION_ID_LENGTH)
  const expectedActivity =
    value.expectedActivity === null ? null : normalizeActivityFence(value.expectedActivity)
  const authorityEpoch =
    value.authorityEpoch === undefined || value.authorityEpoch === null
      ? value.authorityEpoch
      : typeof value.authorityEpoch === 'number' &&
          Number.isSafeInteger(value.authorityEpoch) &&
          value.authorityEpoch >= 0
        ? value.authorityEpoch
        : undefined
  if (
    !sessionId ||
    (value.operationId !== undefined && !operationId) ||
    !AGENT_PROVIDER_ID_SET.has(String(provider)) ||
    (value.resumeSessionId !== null && !resumeSessionId) ||
    (value.expectedActivity !== null && !expectedActivity) ||
    (value.authorityEpoch !== undefined &&
      value.authorityEpoch !== null &&
      authorityEpoch === undefined) ||
    (expectedActivity && expectedActivity.provider !== provider)
  ) {
    return null
  }
  return {
    sessionId,
    ...(operationId ? { operationId } : {}),
    provider: provider as TerminalAgentReexecInput['provider'],
    resumeSessionId,
    expectedActivity,
    ...(authorityEpoch !== undefined ? { authorityEpoch } : {}),
  }
}

export function normalizeTerminalAgentReexecResult(
  value: unknown,
): TerminalAgentReexecResult | null {
  if (!isRecord(value)) {
    return null
  }
  const sessionId = normalizeIdentifier(value.sessionId, MAX_SESSION_ID_LENGTH)
  const operationId = normalizeIdentifier(value.operationId, MAX_OPERATION_ID_LENGTH)
  const status = value.status
  if (!sessionId || !operationId || !TERMINAL_AGENT_REEXEC_STATUSES.has(status as never)) {
    return null
  }
  return { sessionId, operationId, status: status as TerminalAgentReexecStatus }
}

export function terminalAgentActivityMatchesFence(
  current: TerminalAgentActivitySnapshot | null | undefined,
  expected: TerminalAgentActivityFence | null,
): boolean {
  if (!expected) {
    return !current
  }
  if (!current) {
    return false
  }
  return (
    current.provider === expected.provider &&
    current.invocationId === expected.invocationId &&
    current.generation === expected.generation &&
    current.phase === expected.phase &&
    current.observedAtMs === expected.observedAtMs &&
    current.sourceRevision === expected.sourceRevision &&
    current.revision === expected.revision
  )
}

export function toTerminalAgentActivityFence(
  snapshot: TerminalAgentActivitySnapshot,
): TerminalAgentActivityFence {
  return {
    provider: snapshot.provider,
    invocationId: snapshot.invocationId,
    generation: snapshot.generation,
    phase: snapshot.phase,
    observedAtMs: snapshot.observedAtMs,
    ...(snapshot.sourceRevision === undefined
      ? {}
      : { sourceRevision: snapshot.sourceRevision, revision: snapshot.revision }),
  }
}
