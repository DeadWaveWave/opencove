import { isClaudeAuxiliaryUser } from '../../../../shared/runtime/agentHook/claudeTranscriptSemantics'
import { createHash } from 'node:crypto'
import { claudePromptId } from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import {
  markClaudeTranscriptInput,
  type ClaudeTranscriptRecord,
} from '../../../../shared/runtime/agentHook/claudeTranscript'

/** Discard raw content immediately; keys match removals, never identify occurrences. */
export function parseClaudeTranscript(line: string): ClaudeTranscriptRecord | undefined {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return line.trimStart().startsWith('{') ? { kind: 'queue', operation: 'unknown' } : undefined
  }
  if (!record || record.isSidechain === true) {
    return undefined
  }
  if (record.type === 'queue-operation') {
    const operation = ['enqueue', 'remove', 'dequeue'].includes(record.operation)
      ? (record.operation as 'enqueue' | 'remove' | 'dequeue')
      : 'unknown'
    return {
      kind: 'queue',
      operation,
      ...(typeof record.content === 'string'
        ? { key: createHash('sha256').update(record.content).digest('hex') }
        : {}),
    }
  }
  const content = record.message?.content
  const auxiliary = isClaudeAuxiliaryUser(record)
  const promptId = claudePromptId(record.promptId)
  if (record.type === 'user' && promptId) {
    const result: ClaudeTranscriptRecord = {
      kind: 'user',
      promptId,
      promptSource: typeof record.promptSource === 'string' ? record.promptSource : 'unknown',
      ...(claudePromptId(record.uuid) ? { uuid: claudePromptId(record.uuid) } : {}),
    }
    if (auxiliary) {
      markClaudeTranscriptInput(result, 'auxiliary')
    }
    return result
  }
  if (record.type === 'user') {
    // A redacted/non-identifying record cannot establish actual editor input. Keep its
    // checkpoint uncertainty separate from the positive evidence needed to veto a clear.
    const input =
      record.promptId !== undefined ||
      record.promptSource !== undefined ||
      (typeof content === 'string' && content.length > 0) ||
      (Array.isArray(content) && content.length > 0)
    const result: ClaudeTranscriptRecord = { kind: 'invalid_user' }
    if (auxiliary || !input) {
      markClaudeTranscriptInput(result, auxiliary ? 'auxiliary' : 'redacted')
    }
    return result
  }
  if (record.type === 'assistant') {
    return {
      kind: 'assistant',
      parentUuid: claudePromptId(record.parentUuid),
      promptId,
      final: record.message?.stop_reason === 'end_turn',
    }
  }
  return undefined
}
