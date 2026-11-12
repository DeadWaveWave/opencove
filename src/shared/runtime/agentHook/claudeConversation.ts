export interface ClaudeConversationEvent {
  hookEventName: string
  claudeSessionId: string
  emittedAtMs?: number
  sessionStartSource?: string
  transcriptPath?: string
  promptId?: string
}
