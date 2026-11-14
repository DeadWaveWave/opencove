import { boundedInsert } from '../../../shared/utils/boundedInsert'
import type {
  ClaudeConversationEvent,
  ClaudeConversationCheckpoint,
} from '../../../shared/runtime/agentHook/claudeConversation'
export type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'

export function isClaudeConversationActivity(event: ClaudeConversationEvent): boolean {
  return (
    event.hookEventName !== 'SessionStart' &&
    (event.hookEventName === 'SessionEnd' || event.state !== null)
  )
}

/** Provider IDs may resume. Freshness retires observer generations, never invocation authority. */
export class ClaudeConversationLifecycle {
  private current?: string
  private watermark?: number
  private startAt?: number
  private ended = false
  private readonly retired: { sessionId: string; emittedAtMs?: number }[] = []
  constructor(checkpoint?: ClaudeConversationCheckpoint) {
    if (checkpoint) {
      this.current = checkpoint.current
      this.watermark = checkpoint.watermark
      this.startAt = checkpoint.startAt
      this.ended = checkpoint.ended
      for (const item of checkpoint.retired) {
        this.remember(item)
      }
    }
  }
  get currentConversationId(): string | undefined {
    return this.current
  }
  checkpoint(): ClaudeConversationCheckpoint {
    return {
      current: this.current,
      watermark: this.watermark,
      startAt: this.startAt,
      ended: this.ended,
      retired: this.retired.map(item => ({ ...item })),
    }
  }
  accept(event: ClaudeConversationEvent): 'start' | 'end' | 'event' | 'ignore' {
    const at = event.emittedAtMs,
      id = event.claudeSessionId
    if (event.hookEventName === 'SessionStart') {
      const replacement = !!this.current || this.ended || event.sessionStartSource === 'clear'
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
      // First attachment belongs to the fresh invocation, not a conversation handoff.
      // In particular a resumed editor may report Stop without a new prompt submission.
      return replacement ? 'start' : 'event'
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
  dispose(): void {
    this.retired.length = 0
    this.current = this.watermark = this.startAt = undefined
    this.ended = false
  }
  private remember(item: { sessionId: string; emittedAtMs?: number }): void {
    if (this.retired.length === 64) {
      this.retired.shift()
    }
    boundedInsert(
      this.retired.length,
      64,
      () => this.retired.push(item),
      () => {},
    )
  }
  private retire(): void {
    if (this.current) {
      this.remember({ sessionId: this.current, emittedAtMs: this.watermark })
    }
    this.current = undefined
  }
}
