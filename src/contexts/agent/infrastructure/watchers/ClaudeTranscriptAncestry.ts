import { boundedInsert } from '../../../../shared/utils/boundedInsert'
import { claudePromptId } from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import {
  getClaudeTranscriptInput,
  markClaudeTranscriptPrompt,
  type ClaudeTranscriptRecord,
} from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Per-file private correlation. Attachments may sit between the identified user and reply.
 * Losing this optional index can only withhold correlation, never establish completion. */
export class ClaudeTranscriptAncestry {
  private descendants = new Set<string>()
  private prompt?: string
  private incomplete = false
  observe(line: string, record?: ClaudeTranscriptRecord): void {
    let raw
    try {
      raw = JSON.parse(line)
    } catch {
      this.clear()
      return
    }
    if (!raw || raw.isSidechain === true) {
      return
    }
    if (record?.kind === 'user' && getClaudeTranscriptInput(record) !== 'auxiliary') {
      this.clear()
      this.prompt = record.promptId
      if (record.uuid) {
        this.remember(record.uuid)
      }
      return
    }
    const parent = claudePromptId(raw.parentUuid)
    if (!this.prompt || this.incomplete || !parent || !this.descendants.has(parent)) {
      return
    }
    if (
      record?.kind === 'assistant' &&
      (raw.promptId === undefined || raw.promptId === this.prompt)
    ) {
      markClaudeTranscriptPrompt(record, this.prompt)
    }
    const uuid = claudePromptId(raw.uuid)
    if (uuid) {
      this.remember(uuid)
    }
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
  clear(): void {
    this.descendants.clear()
    this.prompt = undefined
    this.incomplete = false
  }
}
