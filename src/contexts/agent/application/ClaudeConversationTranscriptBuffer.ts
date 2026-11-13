import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'

type Pending = {
  record: ClaudeTranscriptObservation
  consume(record: ClaudeTranscriptObservation): void
}
/** IO evidence remains attached to its captured namespace while lifecycle replay is pending. */
export class ClaudeConversationTranscriptBuffer {
  private pending: Pending[] = []
  push(record: ClaudeTranscriptObservation, consume: Pending['consume']): boolean {
    if (this.pending.length === 64) {
      this.clear()
      return false
    }
    this.pending.push({ record, consume })
    return true
  }
  drain(
    providerSessionId: string | undefined,
    generation: number,
    isDisposed: () => boolean,
  ): void {
    const pending = this.pending
    this.clear()
    for (const item of pending) {
      if (isDisposed()) {
        break
      }
      if (item.record.providerSessionId === providerSessionId) {
        item.consume({ ...item.record, conversationGeneration: generation })
      }
    }
  }
  clear(): void {
    this.pending = []
  }
}
