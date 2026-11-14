/** Private same-process evidence. Never serialized into run-state DTOs or events. */
export type ClaudeTranscriptRecord =
  | { kind: 'queue'; operation: 'enqueue' | 'remove' | 'dequeue' | 'unknown'; key?: string }
  | { kind: 'user'; promptId: string; promptSource: string; uuid?: string }
  | { kind: 'invalid_user'; input?: false }
  | { kind: 'assistant'; parentUuid?: string; promptId?: string; final: boolean }
  | { kind: 'checkpoint'; promptId?: string; queueEmpty: boolean; final: boolean }

// Private parser evidence; normalized records retain their ordinary wire-independent shape.
const inputByRecord = new WeakMap<object, 'auxiliary' | 'redacted'>()
export function markClaudeTranscriptInput(
  record: ClaudeTranscriptRecord,
  input: 'auxiliary' | 'redacted',
): void {
  inputByRecord.set(record, input)
}
export function getClaudeTranscriptInput(
  record: ClaudeTranscriptRecord,
): 'auxiliary' | 'redacted' | undefined {
  return inputByRecord.get(record)
}
const promptByRecord = new WeakMap<object, string>()
export function markClaudeTranscriptPrompt(record: ClaudeTranscriptRecord, promptId: string): void {
  promptByRecord.set(record, promptId)
}
export function getClaudeTranscriptPrompt(record: ClaudeTranscriptRecord): string | undefined {
  return promptByRecord.get(record)
}
const completedByRecord = new WeakMap<object, string>()
/** Only a per-file final boundary may certify the records preceding it. */
export function markClaudeTranscriptCompleted(
  record: ClaudeTranscriptRecord,
  promptId: string,
): void {
  completedByRecord.set(record, promptId)
}
export function getClaudeTranscriptCompleted(record: ClaudeTranscriptRecord): string | undefined {
  return completedByRecord.get(record)
}
const afterFinalByRecord = new WeakMap<object, string>()
/** File order proves that this activity follows the first final for this prompt. */
export function markClaudeTranscriptAfterFinal(
  record: ClaudeTranscriptRecord,
  promptId: string,
): void {
  afterFinalByRecord.set(record, promptId)
}
export function getClaudeTranscriptAfterFinal(record: ClaudeTranscriptRecord): string | undefined {
  return afterFinalByRecord.get(record)
}
const stateRecord = new WeakMap<object, ClaudeTranscriptRecord>()
export function markClaudeStateRecord(options: object, record: ClaudeTranscriptRecord): void {
  stateRecord.set(options, record)
}
export function getClaudeStateRecord(options: object): ClaudeTranscriptRecord | undefined {
  return stateRecord.get(options)
}
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
    readonly initialState?: import('./claudeConversation').ClaudeConversationCheckpoint
    event: import('./claudeConversation').ClaudeConversationEvent
    publish(
      generation: number,
      action?: 'start' | 'end' | 'event' | 'ignore',
      /** Preserve ordinary End state projection without reviving ignored observer IO. */
      legacyState?: boolean,
      /** Reconcile observer identity while retaining already-published successor state. */
      publishState?: boolean,
    ): void
    decide(decision: {
      action: 'start' | 'end' | 'event' | 'ignore'
      generation: number
      deferred?: boolean
      reply?: 'reject'
    }): void
  }
  /** Private synchronous capture before watcher IO; never a public DTO field. */
  captureConversation?: (generation: number | undefined, incarnation?: string) => void
  /** Annotation only: ordinary file projection remains on its original path. */
  /** Display-only file state; ordinary observations keep their existing semantics. */
  auxiliary?: true
  activity?: { state: 'working' | 'waiting' | 'idle'; observedAt: number }
  conversationCapture?: object
  captureBinding?: (binding: object) => void
  captureEpoch?: number
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
