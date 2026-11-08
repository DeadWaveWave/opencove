import { createHash } from 'node:crypto'
import { claudePromptId } from '../../../../shared/runtime/agentHook/claudePromptEvidence'
import type { ClaudeTranscriptRecord } from '../../../../shared/runtime/agentHook/claudeTranscript'

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
  const promptId = claudePromptId(record.promptId)
  if (record.type === 'user' && promptId) {
    return {
      kind: 'user',
      promptId,
      promptSource: typeof record.promptSource === 'string' ? record.promptSource : 'unknown',
      ...(claudePromptId(record.uuid) ? { uuid: claudePromptId(record.uuid) } : {}),
    }
  }
  if (record.type === 'user') {
    return { kind: 'invalid_user' }
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
