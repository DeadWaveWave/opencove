export interface ClaudeConversationEvent {
  /** Normalized activity; null explicitly means passive, undefined preserves legacy input. */
  state?: 'working' | 'waiting' | 'standby' | 'done' | null
  hookEventName: string
  claudeSessionId: string
  emittedAtMs?: number
  sessionStartSource?: string
  sessionEndReason?: 'clear'
  transcriptPath?: string
  promptId?: string
}
