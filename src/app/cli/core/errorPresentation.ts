import type { CliError } from './errors'

/** Closed allowlist: a code alone, an absent reason or a new reason never permits retry. */
const retryableReasons: Readonly<Record<string, readonly string[]>> = {
  'context.unreachable': ['connection_refused'],
  'worker.unavailable': ['connection_refused'],
  'transport.timeout': ['read_timeout'],
  'agent.wait_timeout': ['wait_timeout'],
}

export function errorRetryable(error: CliError, safeToRepeat: boolean): boolean {
  const details = error.details as Record<string, unknown> | undefined
  return (
    safeToRepeat &&
    details?.deliveryOutcome !== 'unknown' &&
    details?.pasteDispatchAttempted !== true &&
    details?.submitDispatchAttempted !== true &&
    typeof details?.reason === 'string' &&
    Object.hasOwn(retryableReasons, error.code) &&
    retryableReasons[error.code].includes(details.reason)
  )
}

export function errorCandidates(error: CliError): unknown[] | undefined {
  const details = error.details as Record<string, unknown> | undefined
  const candidates =
    details && Array.isArray(details.candidates)
      ? details.candidates
      : error.exitCode === 6 && Array.isArray(details)
        ? details
        : undefined
  return candidates?.map(candidate => {
    if (!candidate || typeof candidate !== 'object') {
      return candidate
    }
    if ('spaceId' in candidate && !('id' in candidate)) {
      return { ...candidate, id: candidate.spaceId, kind: 'space', title: candidate.spaceName }
    }
    if ('userData' in candidate && !('id' in candidate)) {
      return { ...candidate, id: candidate.userData, kind: 'profile' }
    }
    return candidate
  })
}

/** Escape terminal and bidi controls in untrusted display text; JSON retains original values. */
export function safeTerminalText(value: unknown): string {
  return String(value).replace(
    /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    character => {
      const escaped = JSON.stringify(character).slice(1, -1)
      return escaped === character
        ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        : escaped
    },
  )
}

export function candidateText(candidates: unknown[] | undefined): string {
  if (!candidates?.length) {
    return ''
  }
  return (
    '  Candidates:\n' +
    candidates
      .map(candidate => {
        const c =
          candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {}
        return `    ${[c.id, c.kind, c.title ?? c.name, c.spaceName ?? c.directoryPath]
          .filter(v => v !== undefined && v !== null)
          .map(safeTerminalText)
          .join('  ')}`
      })
      .join('\n') +
    '\n'
  )
}
