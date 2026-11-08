import type { ClaudeHookEnvelope } from './claudeHookProtocol'

/** Provider IDs may resume. Freshness retires observer generations, never invocation authority. */
export class ClaudeTranscriptGeneration {
  private current?: string
  private watermark?: number
  private startAt?: number
  private ended = false
  private readonly retired: { sessionId: string; emittedAtMs?: number }[] = []
  accept(event: ClaudeHookEnvelope): 'start' | 'end' | 'event' | 'ignore' {
    const at = event.emittedAtMs,
      id = event.claudeSessionId
    if (event.hookEventName === 'SessionStart') {
      if (this.current || this.ended) {
        if (at === undefined) {
          return !this.ended && id === this.current ? 'event' : 'ignore'
        }
        if (this.watermark !== undefined && at <= this.watermark) {
          return 'ignore'
        }
        if (
          this.ended &&
          id === this.retired.at(-1)?.sessionId &&
          event.sessionStartSource === 'compact'
        ) {
          return 'ignore'
        }
        // A same-session refresh is not a new conversation, even with a newer relay time.
        if (!this.ended && this.current === id && event.sessionStartSource !== 'clear') {
          this.watermark = at
          return 'event'
        }
        this.retire()
      }
      this.current = id
      this.startAt = at
      this.watermark = at
      this.ended = false
      return 'start'
    }
    if (
      this.ended ||
      (at === undefined && this.startAt !== undefined) ||
      (this.current && id !== this.current) ||
      (at !== undefined && this.startAt !== undefined && at < this.startAt)
    ) {
      return 'ignore'
    }
    this.current = id
    if (event.hookEventName === 'SessionEnd') {
      if (at !== undefined && this.watermark !== undefined && at < this.watermark) {
        return 'ignore'
      }
      this.watermark = at ?? this.watermark
      this.retire()
      this.ended = true
      return 'end'
    }
    if (at !== undefined) {
      this.watermark = Math.max(this.watermark ?? -Infinity, at)
    }
    return 'event'
  }
  private retire(): void {
    if (this.current) {
      this.retired.push({ sessionId: this.current, emittedAtMs: this.watermark })
      if (this.retired.length > 64) {
        this.retired.shift()
      }
    }
    this.current = undefined
  }
}
