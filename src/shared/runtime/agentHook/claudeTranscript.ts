/** Private same-process evidence. Never serialized into run-state DTOs or events. */
export type ClaudeTranscriptRecord =
  | { kind: 'queue'; operation: 'enqueue' | 'remove' | 'dequeue' | 'unknown'; key?: string }
  | { kind: 'user'; promptId: string; promptSource: string; uuid?: string }
  | { kind: 'invalid_user'; input?: false }
  | { kind: 'assistant'; parentUuid?: string; promptId?: string; final: boolean }
  | { kind: 'checkpoint'; promptId?: string; queueEmpty: boolean; final: boolean }
export interface ClaudeTranscriptObservation {
  sessionId: string
  incarnation?: string
  providerSessionId: string
  fileIdentity: string
  generation: number
  position: number
  origin?: 'hook' | 'session_file'
  baseline: boolean
  /** Accepted observer generation transition, independent of provider identity reuse. */
  conversation?: {
    event: import('./claudeConversation').ClaudeConversationEvent
    publish(
      generation: number,
      action?: 'start' | 'end' | 'event' | 'ignore',
      /** Preserve ordinary End state projection without reviving ignored observer IO. */
      legacyState?: boolean,
    ): void
    decide(decision: {
      action: 'start' | 'end' | 'event' | 'ignore'
      generation: number
      deferred?: boolean
    }): void
  }
  /** Private synchronous capture before watcher IO; never a public DTO field. */
  captureConversation?: (generation: number) => void
  conversationGeneration?: number
  lifecycle?: 'start' | 'end'
  /** Private IO capability: the registry owns demand; the observer owns scheduling. */
  setPollingDemand?: (needed: boolean) => void
  reading?: boolean
  record?: ClaudeTranscriptRecord
  unavailable?: boolean
}
export interface ClaudeTranscriptPort {
  onClaudeTranscript?: (listener: (record: ClaudeTranscriptObservation) => void) => () => void
}
/** Local-only side channel. Never forwarded to renderer, HTTP or mounted Workers. */
export class ClaudeTranscriptChannel {
  private readonly listeners = new Set<(record: ClaudeTranscriptObservation) => void>()
  subscribe = (listener: (record: ClaudeTranscriptObservation) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  emit = (record: ClaudeTranscriptObservation): void => {
    this.listeners.forEach(listener => listener(record))
  }
  dispose(): void {
    this.listeners.clear()
  }
}
