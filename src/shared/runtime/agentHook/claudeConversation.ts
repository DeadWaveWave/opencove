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

/** Classifier checkpoint, copied only when an authenticated clear opens a transition. */
export interface ClaudeConversationCheckpoint {
  current?: string
  watermark?: number
  startAt?: number
  ended: boolean
  retired: { sessionId: string; emittedAtMs?: number }[]
}
