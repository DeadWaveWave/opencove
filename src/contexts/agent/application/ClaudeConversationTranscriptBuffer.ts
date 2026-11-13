import { boundedInsert } from '../../../shared/utils/boundedInsert'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'

type Pending = {
  record: ClaudeTranscriptObservation
  consume(record: ClaudeTranscriptObservation): void
}
/** IO evidence remains attached to its captured namespace while lifecycle replay is pending. */
export class ClaudeConversationTranscriptBuffer {
  private pending: Pending[] = []
  defer(
    record: ClaudeTranscriptObservation,
    consume: Pending['consume'],
    scope: { generation?: number; providerSessionId?: string } | undefined,
  ): 'unmatched' | 'deferred' | 'overflow' {
    if (
      !scope ||
      scope.generation === undefined ||
      record.conversationGeneration !== scope.generation ||
      record.providerSessionId !== scope.providerSessionId
    ) {
      return 'unmatched'
    }
    return this.push(record, consume) ? 'deferred' : 'overflow'
  }
  push(record: ClaudeTranscriptObservation, consume: Pending['consume']): boolean {
    return boundedInsert(
      this.pending.length,
      64,
      () => this.pending.push({ record, consume }),
      () => {},
    )
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
