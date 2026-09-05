import type { TerminalSessionStateEvent } from '../contracts/dto'

export function normalizePiStateObservationMetadata(value: {
  piConversation?: unknown
  observationUnavailable?: unknown
}): Pick<TerminalSessionStateEvent, 'piConversation' | 'observationUnavailable'> {
  const piConversation = normalizePiConversation(value.piConversation)
  return piConversation
    ? {
        piConversation,
        ...(value.observationUnavailable === true ? { observationUnavailable: true } : {}),
      }
    : {}
}

export function normalizePiConversation(
  value: unknown,
): TerminalSessionStateEvent['piConversation'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const { pid, revision } = value as Record<string, unknown>
  return typeof pid === 'number' &&
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision > 0
    ? { pid, revision }
    : null
}
