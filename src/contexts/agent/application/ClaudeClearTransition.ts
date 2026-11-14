import type { ClaudeConversationEvent } from '../domain/ClaudeConversationLifecycle'

export const CLAUDE_CLEAR_QUIET_MS = 200
export const CLAUDE_CLEAR_MAX_MS = 4_000
export function isClaudeClearEvidence(event: ClaudeConversationEvent): boolean {
  return (
    (event.hookEventName === 'SessionStart' && event.sessionStartSource === 'clear') ||
    (event.hookEventName === 'SessionEnd' && event.sessionEndReason === 'clear')
  )
}
/** A sufficient trigger to try committing; the registry still confirms actual completion. */
export function hasCompleteClearTurn(events: ClaudeConversationEvent[]): boolean {
  const start = events
    .filter(event => event.hookEventName === 'SessionStart')
    .sort((a, b) => a.emittedAtMs! - b.emittedAtMs!)
    .at(-1)
  if (!start || start.sessionStartSource !== 'clear') {
    return false
  }
  const submissions = events.filter(
    event =>
      event.hookEventName === 'UserPromptSubmit' &&
      event.claudeSessionId === start.claudeSessionId &&
      event.emittedAtMs! > start.emittedAtMs!,
  )
  const latest = submissions.sort((a, b) => a.emittedAtMs! - b.emittedAtMs!).at(-1)
  if (!latest?.promptId) {
    return false
  }
  return events.some(
    event =>
      ['Stop', 'StopFailure'].includes(event.hookEventName) &&
      event.claudeSessionId === start.claudeSessionId &&
      event.promptId === latest.promptId &&
      event.emittedAtMs! > latest.emittedAtMs!,
  )
}
