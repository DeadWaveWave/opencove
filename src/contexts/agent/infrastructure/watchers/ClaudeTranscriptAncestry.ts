import { boundedInsert } from '../../../../shared/utils/boundedInsert'
import { claudePromptId } from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import {
  getClaudeTranscriptInput,
  markClaudeTranscriptPrompt,
  markClaudeTranscriptCompleted,
  markClaudeTranscriptAfterFinal,
  type ClaudeTranscriptRecord,
} from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Per-file private correlation. Attachments may sit between the identified user and reply.
 * Losing this optional index can only withhold correlation, never establish completion. */
export class ClaudeTranscriptAncestry {
  private descendants = new Set<string>()
  private prompt?: string
  private incomplete = false
  private pending = new Set<ClaudeTranscriptRecord>()
  private finalPrompt?: string
  observe(line: string, record?: ClaudeTranscriptRecord): void {
    let raw
    try {
      raw = JSON.parse(line)
    } catch {
      this.invalidate()
      return
    }
    if (!raw || raw.isSidechain === true) {
      return
    }
    if (record?.kind === 'user' && getClaudeTranscriptInput(record) !== 'auxiliary') {
      this.clear()
      this.prompt = record.promptId
      this.rememberPending(record)
      if (record.uuid) {
        this.remember(record.uuid)
      }
      return
    }
    const beforeFinal = this.finalPrompt === undefined
    if (record?.kind === 'assistant') {
      if (this.finalPrompt) {
        markClaudeTranscriptAfterFinal(record, this.finalPrompt)
      }
      if (record.final) {
        this.finalPrompt ??= claudePromptId(record.promptId)
      }
    }
    const parent = claudePromptId(raw.parentUuid)
    if (!this.prompt || this.incomplete || !parent || !this.descendants.has(parent)) {
      return
    }
    if (
      record?.kind === 'assistant' &&
      raw.promptId !== undefined &&
      raw.promptId !== this.prompt
    ) {
      return
    }
    if (
      record?.kind === 'assistant' &&
      (raw.promptId === undefined || raw.promptId === this.prompt)
    ) {
      markClaudeTranscriptPrompt(record, this.prompt)
      if (beforeFinal && !this.pending.has(record)) {
        this.rememberPending(record)
      }
      if (record.final && beforeFinal && !this.incomplete) {
        this.pending.forEach(item => markClaudeTranscriptCompleted(item, this.prompt!))
        this.pending.clear()
        this.finalPrompt ??= this.prompt
      }
    }
    const uuid = claudePromptId(raw.uuid)
    if (uuid) {
      this.remember(uuid)
    }
  }
  private rememberPending(record: ClaudeTranscriptRecord): void {
    boundedInsert(
      this.pending.size,
      512,
      () => this.pending.add(record),
      () => {
        this.incomplete = true
      },
    )
  }
  private remember(uuid: string): void {
    if (!this.descendants.has(uuid)) {
      boundedInsert(
        this.descendants.size,
        512,
        () => this.descendants.add(uuid),
        () => {
          this.incomplete = true
        },
      )
    }
  }
  private invalidate(): void {
    this.descendants.clear()
    this.pending.clear()
    this.prompt = undefined
    this.incomplete = true
  }
  clear(): void {
    this.invalidate()
    this.finalPrompt = undefined
    this.incomplete = false
  }
}
