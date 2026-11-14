import { claudePromptId } from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import { hasClaudeHumanOrigin } from '../../../../shared/runtime/agentHook/claudeTranscriptSemantics'
import {
  markClaudeTranscriptInput,
  type ClaudeTranscriptRecord,
} from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Constant-size pending links. Dropping an unproven candidate never removes its input veto. */
export class ClaudeLocalCommandEvidence {
  private caveat?: { uuid: string; session: string }
  private echo?: { uuid: string; session: string; record: ClaudeTranscriptRecord }
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
    const uuid = claudePromptId(raw.uuid),
      session = claudePromptId(raw.sessionId)
    if (!uuid || !session) {
      return
    }
    if (raw.type === 'user') {
      if (
        hasClaudeHumanOrigin(raw) ||
        raw.promptId !== undefined ||
        raw.promptSource !== undefined
      ) {
        this.clear()
        return
      }
      const content = raw.message?.content
      if (
        raw.isMeta === true &&
        typeof content === 'string' &&
        /^<local-command-caveat>[\s\S]*<\/local-command-caveat>$/u.test(content.trim())
      ) {
        this.caveat = { uuid, session }
        this.echo = undefined
      } else if (
        record &&
        this.caveat?.session === session &&
        raw.parentUuid === this.caveat.uuid &&
        typeof content === 'string' &&
        (content.trim() === '/clear' ||
          /^<command-name>\/clear<\/command-name>\s*(?:<command-message>clear<\/command-message>\s*)?(?:<command-args><\/command-args>)?$/u.test(
            content.trim(),
          ))
      ) {
        this.echo = { uuid, session, record }
      } else {
        this.clear()
      }
    } else if (
      raw.type === 'system' &&
      raw.subtype === 'local_command' &&
      raw.commandRun?.command === 'clear' &&
      raw.commandRun.args === '' &&
      this.echo?.session === session &&
      raw.parentUuid === this.echo.uuid
    ) {
      markClaudeTranscriptInput(this.echo.record, 'auxiliary')
      this.clear()
    }
  }
  clear(): void {
    this.caveat = undefined
    this.echo = undefined
  }
}
