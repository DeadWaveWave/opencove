import { expect, it } from 'vitest'
import { ClaudeTranscriptAncestry } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAncestry'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { getClaudeTranscriptPrompt } from '../../../src/shared/runtime/agentHook/claudeTranscript'
const user = { type: 'user', promptId: 'p', uuid: 'u', message: { content: 'work' } }
function fixture() {
  const ancestry = new ClaudeTranscriptAncestry()
  const append = (value: unknown) => {
    const line = JSON.stringify(value),
      record = parseClaudeTranscript(line)
    ancestry.observe(line, record)
    return record!
  }
  append(user)
  return { ancestry, append }
}
it('follows metadata parents without changing ordinary normalized assistant records', () => {
  const f = fixture()
  f.append({ type: 'attachment', uuid: 'a', parentUuid: 'u' })
  f.append({ type: 'system', uuid: 's', parentUuid: 'a', subtype: 'local_command', isMeta: false })
  const assistant = f.append({
    type: 'assistant',
    parentUuid: 's',
    message: { stop_reason: 'end_turn' },
  })
  expect(getClaudeTranscriptPrompt(assistant)).toBe('p')
  expect(assistant).toStrictEqual({
    kind: 'assistant',
    parentUuid: 's',
    promptId: undefined,
    final: true,
  })
  expect(
    getClaudeTranscriptPrompt(f.append({ type: 'assistant', parentUuid: 'unknown' })),
  ).toBeUndefined()
  expect(
    getClaudeTranscriptPrompt(f.append({ type: 'assistant', parentUuid: 's', promptId: 'other' })),
  ).toBeUndefined()
})
it('bounds optional ancestry, fails closed on overflow and clears it for a new identified input or disposal', () => {
  const f = fixture()
  for (let n = 0; n < 1024; n++) {
    f.append({ type: 'attachment', uuid: `a${n}`, parentUuid: 'u' })
  }
  expect((f.ancestry as unknown as { descendants: Set<string> }).descendants.size).toBe(512)
  expect(
    getClaudeTranscriptPrompt(f.append({ type: 'assistant', parentUuid: 'u' })),
  ).toBeUndefined()
  f.append({ ...user, promptId: 'new', uuid: 'new-user' })
  expect(getClaudeTranscriptPrompt(f.append({ type: 'assistant', parentUuid: 'new-user' }))).toBe(
    'new',
  )
  f.ancestry.clear()
  expect((f.ancestry as unknown as { descendants: Set<string> }).descendants.size).toBe(0)
})
