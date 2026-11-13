import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'

/** Invocation-local receipt identity: replay remains idempotent with fixed retention. */
export class ClaudeConversationReceipts {
  static key(event: ClaudeConversationEvent): string {
    return JSON.stringify([
      event.claudeSessionId,
      event.hookEventName,
      event.emittedAtMs,
      event.sessionStartSource,
      event.sessionEndReason,
      event.promptId,
      event.state,
    ])
  }
  private readonly values = new Set<string>()
  has(value: string): boolean {
    return this.values.has(value)
  }
  add(value: string): void {
    this.values.add(value)
    if (this.values.size > 256) {
      this.values.delete(this.values.values().next().value!)
    }
  }
}

/** Receiver retention limits can withdraw clear authority, never ordinary lifecycle tracking. */
export class ClaudeRetiredConversations extends Set<string> {
  limited = false
  override add(id: string): this {
    super.add(id)
    this.limited ||= this.size >= 64
    while (this.size > 64) {
      this.delete(this.values().next().value!)
    }
    return this
  }
}

/** Highest qualifying relay evidence survives queue expiry; passive events have no authority. */
export class ClaudeConversationWatermark {
  private value = -Infinity
  private recoveryAfter?: number
  private ends = new Map<string, number>()
  observeAt(at: number | undefined): void {
    if (at !== undefined && Number.isFinite(at)) {
      this.value = Math.max(this.value, at)
    }
  }
  observe(event: ClaudeConversationEvent): void {
    this.observeAt(event.emittedAtMs)
    if (
      event.hookEventName === 'SessionEnd' &&
      event.sessionEndReason === 'clear' &&
      Number.isFinite(event.emittedAtMs)
    ) {
      this.ends.set(
        event.claudeSessionId,
        Math.max(this.ends.get(event.claudeSessionId) ?? -Infinity, event.emittedAtMs!),
      )
      if (this.ends.size > 64) {
        this.ends.delete(this.ends.keys().next().value!)
      }
    }
  }
  canRecover(event: ClaudeConversationEvent): boolean {
    return event.emittedAtMs! > (this.ends.get(event.claudeSessionId) ?? -Infinity)
  }
  recoverAt(at: number): void {
    this.recoveryAfter = this.unresolvedAfter(at)
  }
  establishAt(at: number, input: { block(at: number): void }): void {
    if (this.recoveryAfter === undefined) {
      return
    }
    if (at > this.recoveryAfter) {
      this.recoveryAfter = undefined
    } else {
      input.block(this.recoveryAfter)
    }
  }
  unresolvedAfter(at: number): number | undefined {
    return at <= this.value ? this.value : undefined
  }
}

/** Unknown, non-retired identities may withdraw input using a capture from this invocation.
 * Expiring a transition never turns an already-issued callback into permission to ignore work.
 * Current/reused identities still require exact generation matching at ordinary ingress. */
export function isPossibleConversationCapture(
  captured: number | undefined,
  current: number,
  unsettled: boolean,
): boolean {
  return (
    captured === current ||
    (unsettled &&
      (captured === undefined ||
        (Number.isInteger(captured) && captured! >= 0 && captured! <= current)))
  )
}
