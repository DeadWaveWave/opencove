import { expect, it } from 'vitest'
import { ClaudeTranscriptAncestry } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAncestry'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import {
  getClaudeTranscriptPrompt,
  getClaudeTranscriptAfterFinal,
  getClaudeTranscriptCompleted,
} from '../../../src/shared/runtime/agentHook/claudeTranscript'
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
it('certifies only the linked activity preceding the first final boundary', () => {
  const f = fixture()
  const thinking = f.append({ type: 'assistant', uuid: 't', parentUuid: 'u' })
  expect(getClaudeTranscriptPrompt(thinking)).toBe('p')
  expect(getClaudeTranscriptCompleted(thinking)).toBeUndefined()
  f.append({ type: 'assistant', uuid: 'f', parentUuid: 't', message: { stop_reason: 'end_turn' } })
  expect(getClaudeTranscriptCompleted(thinking)).toBe('p')
  const late = f.append({ type: 'assistant', uuid: 'late', parentUuid: 'f' })
  f.append({ type: 'assistant', parentUuid: 'late', message: { stop_reason: 'end_turn' } })
  expect(getClaudeTranscriptCompleted(late)).toBeUndefined()
})
it('cannot certify activity through a mismatched prompt or an overflowed ancestry index', () => {
  const f = fixture()
  const thinking = f.append({ type: 'assistant', uuid: 't', parentUuid: 'u' })
  f.append({ type: 'assistant', uuid: 'wrong', parentUuid: 't', promptId: 'other' })
  f.append({ type: 'assistant', parentUuid: 'wrong', message: { stop_reason: 'end_turn' } })
  expect(getClaudeTranscriptCompleted(thinking)).toBeUndefined()
  for (let n = 0; n < 1024; n++) {
    f.append({ type: 'assistant', uuid: `t${n}`, parentUuid: 'u' })
  }
  expect((f.ancestry as unknown as { pending: Set<unknown> }).pending.size).toBeLessThanOrEqual(512)
  f.append({ type: 'assistant', parentUuid: 't', message: { stop_reason: 'end_turn' } })
  expect(getClaudeTranscriptCompleted(thinking)).toBeUndefined()
  f.ancestry.clear()
  expect((f.ancestry as unknown as { pending: Set<unknown> }).pending.size).toBe(0)
})

it.each(['missing', 'unknown', 'no-user', 'overflow', 'malformed-after-final'])(
  'retains explicit final ordering without claiming incomplete ancestry: %s',
  variant => {
    const f = fixture()
    const preceding = f.append({ type: 'assistant', parentUuid: 'u', uuid: 'thinking' })
    if (variant === 'no-user') {
      f.ancestry.clear()
    }
    if (variant === 'overflow') {
      for (let n = 0; n < 1024; n++) {
        f.append({ type: 'attachment', uuid: `a${n}`, parentUuid: 'u' })
      }
    }
    f.append({
      type: 'assistant',
      uuid: 'f',
      promptId: 'p',
      parentUuid: variant === 'missing' ? undefined : 'unknown',
      message: { stop_reason: 'end_turn' },
    })
    if (variant === 'malformed-after-final') {
      f.ancestry.observe('{')
    }
    const later = f.append({ type: 'assistant', promptId: 'p', parentUuid: 'f' })
    expect(getClaudeTranscriptAfterFinal(later)).toBe('p')
    expect(getClaudeTranscriptCompleted(preceding)).toBeUndefined()
  },
)
