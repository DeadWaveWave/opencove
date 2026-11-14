import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixture = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
  .map(line => JSON.parse(line))
const metadata = fixture.find(record => record.type === 'user' && record.isMeta)
const user = fixture.find(record => record.type === 'user' && record.promptId)
const assistant = fixture.find(record => record.type === 'assistant')
export type TranscriptVariant =
  | 'metadata'
  | 'identified-metadata'
  | 'local-command'
  | 'command-markup'
  | 'user'
  | 'assistant'
  | 'enqueue'
  | 'remove'

/** Real-shape fixture variants; each implementation parses these bytes independently. */
export function transcriptLine(variant: TranscriptVariant, id: string, prompt = 'p'): string {
  const uuid = `user-${id}-${prompt}`
  if (variant === 'enqueue' || variant === 'remove') {
    return JSON.stringify({
      type: 'queue-operation',
      sessionId: id,
      operation: variant,
      content: 'queued fixture input',
    })
  }
  if (variant === 'user') {
    return JSON.stringify({ ...user, sessionId: id, uuid, promptId: prompt, promptSource: 'typed' })
  }
  if (variant === 'assistant') {
    return JSON.stringify({ ...assistant, sessionId: id, parentUuid: uuid, promptId: prompt })
  }
  if (variant === 'identified-metadata') {
    return JSON.stringify({ ...metadata, sessionId: id, promptId: prompt, promptSource: 'queued' })
  }
  return JSON.stringify({
    ...metadata,
    sessionId: id,
    isMeta: variant === 'metadata',
    message: {
      role: 'user',
      content:
        variant === 'metadata'
          ? 'Session metadata'
          : variant === 'local-command'
            ? '/clear'
            : '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>',
    },
  })
}
