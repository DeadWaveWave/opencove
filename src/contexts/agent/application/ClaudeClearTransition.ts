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
  const starts = events.filter(event => event.hookEventName === 'SessionStart')
  if (starts.length !== 1 || starts[0].sessionStartSource !== 'clear') {
    return false
  }
  const start = starts[0]
  const submissions = events.filter(
    event =>
      event.hookEventName === 'UserPromptSubmit' &&
      event.claudeSessionId === start.claudeSessionId &&
      event.emittedAtMs! > start.emittedAtMs!,
  )
  if (submissions.length !== 1 || !submissions[0].promptId) {
    return false
  }
  return events.some(
    event =>
      ['Stop', 'StopFailure'].includes(event.hookEventName) &&
      event.claudeSessionId === start.claudeSessionId &&
      event.promptId === submissions[0].promptId &&
      event.emittedAtMs! > submissions[0].emittedAtMs!,
  )
}
