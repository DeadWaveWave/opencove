import { ClaudeTranscriptAncestry } from './ClaudeTranscriptAncestry'
import type { ClaudeTranscriptRecord } from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Content-free fold of the actual file prefix; EOF is evidence, silence is not. */
export class ClaudeTranscriptCheckpoint {
  private ancestry = new ClaudeTranscriptAncestry()
  private count = 0
  private known = true
  private promptId?: string
  private uuid?: string
  private final = false
  invalidate(): void {
    this.known = false
    this.final = false
  }
  observe(record?: ClaudeTranscriptRecord, line?: string): void {
    if (line !== undefined) {
      this.ancestry.observe(line, record)
    }
    if (record?.kind === 'queue') {
      if (record.operation === 'unknown') {
        this.known = false
      } else if (record.operation === 'enqueue') {
        this.count++
        if (this.count > 64) {
          this.known = false
        }
      } else if (this.count > 0) {
        this.count--
      } else {
        this.known = false
      }
    } else if (record?.kind === 'user') {
      this.promptId = record.promptId
      this.uuid = record.uuid
      this.final = false
    } else if (record?.kind === 'invalid_user') {
      this.promptId = undefined
      this.uuid = undefined
      this.final = false
    } else if (record?.kind === 'assistant') {
      this.final =
        record.final &&
        !!this.promptId &&
        (record.promptId === this.promptId || (!!this.uuid && record.parentUuid === this.uuid))
    }
  }
  dispose(): void {
    this.ancestry.clear()
  }
  read(complete: boolean): ClaudeTranscriptRecord {
    return {
      kind: 'checkpoint',
      promptId: this.promptId,
      queueEmpty: this.known && this.count === 0,
      final: complete && this.final,
    }
  }
}
