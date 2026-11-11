/** Local private channel. Never serialized or forwarded to mounted Workers. */
export interface ClaudeBindingEvidence {
  sessionId: string
  credential: object
  incarnation: string
  isCurrent(): boolean
  configDirectories: readonly string[]
  event: {
    hookEventName: string
    claudeSessionId: string
    emittedAtMs?: number
    sessionStartSource?: string
    transcriptPath?: string
    promptId?: string
  }
  action: 'start' | 'end' | 'event' | 'ignore'
}
export interface ClaudeBindingEvidencePort {
  onClaudeBindingEvidence?: (
    listener: (evidence: ClaudeBindingEvidence) => void,
    close: (credential: object) => void,
  ) => () => void
}
