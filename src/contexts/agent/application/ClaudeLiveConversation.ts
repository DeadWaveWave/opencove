import {
  ClaudeConversationLifecycle,
  type ClaudeConversationEvent,
} from '../domain/ClaudeConversationLifecycle'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'

type Pending = {
  event: ClaudeConversationEvent
  publish(generation: number): void
  receivedAt: number
}
/** Invocation-local live authority. Relay ordering is best effort, never provider causal order. */
export class ClaudeLiveConversation {
  private readonly lifecycle = new ClaudeConversationLifecycle()
  private readonly retired = new Set<string>()
  private pending: Pending[] = []
  private uncertain = false
  generation = 0
  providerSessionId?: string
  ready = false
  quarantined = false
  private ended = false

  accept(
    record: ClaudeTranscriptObservation,
    now: number,
    ports: {
      reset(): void
      invalidate(): void
      canReady(): boolean
      ready(): void
    },
  ): void {
    const request = record.conversation!
    const event = request.event
    const previous = this.providerSessionId
    const action = this.lifecycle.accept(event)
    request.decide({ action, generation: this.generation })
    if (action === 'ignore') {
      if (
        event.claudeSessionId !== previous &&
        !this.retired.has(event.claudeSessionId) &&
        event.hookEventName !== 'SessionStart'
      ) {
        if (!this.quarantined) {
          this.generation++
          this.quarantined = true
          this.ready = false
          ports.invalidate()
        }
        if (this.pending.length >= 16) {
          this.uncertain = true
        } else {
          this.pending.push({ event, publish: request.publish, receivedAt: now })
        }
      }
      return
    }
    if (action === 'start' || action === 'end') {
      const reused = this.retired.has(event.claudeSessionId) || previous === event.claudeSessionId
      if (previous) {
        this.retired.add(previous)
      }
      // Keep the classifier's bounded identity retention; overflow can never grant readiness.
      if (this.retired.size > 64) {
        this.retired.delete(this.retired.values().next().value!)
        this.uncertain = true
      }
      this.generation++
      this.providerSessionId = event.claudeSessionId
      this.ready = false
      this.ended = action === 'end'
      const pending = this.pending
      this.pending = []
      this.quarantined =
        this.uncertain ||
        pending.some(
          item =>
            now - item.receivedAt > 2000 ||
            item.event.claudeSessionId !== event.claudeSessionId ||
            item.event.emittedAtMs === undefined ||
            event.emittedAtMs === undefined ||
            item.event.emittedAtMs < event.emittedAtMs,
        )
      ports.reset()
      if (action === 'start' && !this.quarantined) {
        for (const item of pending) {
          // Replay updates the same classifier watermark before live publication.
          if (this.lifecycle.accept(item.event) !== 'ignore') {
            item.publish(this.generation)
          }
        }
        if (
          !pending.length &&
          event.sessionStartSource === 'clear' &&
          !reused &&
          event.emittedAtMs !== undefined &&
          ports.canReady()
        ) {
          this.ready = true
          ports.ready()
        }
      }
      request.decide({ action, generation: this.generation })
      return
    }
    this.providerSessionId = event.claudeSessionId
    if (event.hookEventName !== 'SessionStart') {
      this.ready = false
    }
    request.decide({ action, generation: this.generation })
  }
  accepts(generation: number | undefined, providerSessionId: string | undefined): boolean {
    return (
      generation === undefined ||
      (!this.ended &&
        !this.quarantined &&
        generation === this.generation &&
        providerSessionId === this.providerSessionId)
    )
  }
  veto(): void {
    this.ready = false
  }
}
