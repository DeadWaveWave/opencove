import type { AgentSessionSummary } from '@shared/contracts/dto'

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

export function toIsoString(timestampMs: number | null): string | null {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) {
    return null
  }

  return new Date(timestampMs).toISOString()
}

function toSortTimestampMs(session: AgentSessionSummary): number {
  const updatedAtMs = Date.parse(session.updatedAt ?? '')
  if (Number.isFinite(updatedAtMs)) {
    return updatedAtMs
  }

  const startedAtMs = Date.parse(session.startedAt ?? '')
  return Number.isFinite(startedAtMs) ? startedAtMs : 0
}

export function sortSessionSummaries(
  sessions: AgentSessionSummary[],
  limit: number,
): AgentSessionSummary[] {
  return [...sessions]
    .sort((left, right) => toSortTimestampMs(right) - toSortTimestampMs(left))
    .slice(0, limit)
}
