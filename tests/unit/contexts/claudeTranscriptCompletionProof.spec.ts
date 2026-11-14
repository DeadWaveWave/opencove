import { expect, it } from 'vitest'
import { ClaudeJournalProof } from '../../../src/contexts/agent/application/ClaudeJournalProof'
import type { JournalFact } from '../../../src/contexts/agent/application/ClaudeJournalFact'
import { ClaudeTranscriptAncestry } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAncestry'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

const fact = (kind: JournalFact['kind'], at: number): JournalFact => ({
  kind,
  id: 'B',
  at,
  received: at,
  order: at,
  key: `${kind}:${at}`,
})
const start = fact('start', 10)
const stop = { ...fact('complete', 50), promptId: 'p' }
function fixture() {
  const ancestry = new ClaudeTranscriptAncestry()
  return (raw: unknown) => {
    const line = JSON.stringify(raw)
    const record = parseClaudeTranscript(line)!
    ancestry.observe(line, record)
    return record
  }
}
const assistant = (parentUuid: string, promptId?: string) => ({
  type: 'assistant',
  parentUuid,
  promptId,
  message: { content: [{ type: 'thinking', thinking: 'work' }], stop_reason: null },
})
it.each(['p', 'q', undefined])(
  'requires positive prompt ownership for unlinked assistant activity, prompt=%s',
  promptId => {
    const record = fixture()(assistant('unknown', promptId))
    const activity = {
      ...fact('activity', 30),
      transcript: record,
      io: true,
      input: true,
      promptId,
    }
    expect(new ClaudeJournalProof([start, activity, stop]).resolved(activity)).toBe(
      promptId === 'p',
    )
  },
)
it.each(['p', 'q', undefined])(
  'preserves the first final boundary independently of Stop arrival order, prompt=%s',
  promptId => {
    const append = fixture()
    append({ type: 'user', uuid: 'u', promptId: 'p', message: { content: 'work' } })
    const before = append({ ...assistant('u'), uuid: 't' })
    append({ type: 'assistant', uuid: 'f', parentUuid: 't', message: { stop_reason: 'end_turn' } })
    // Also protect sibling/unknown-parent records later in the file, not only final descendants.
    for (const parent of ['u', 'f', 'unknown']) {
      const after = append(assistant(parent, promptId))
      for (const order of [20, 60]) {
        const lateStop = { ...stop, order }
        const activity = {
          ...fact('activity', 30),
          transcript: after,
          io: true,
          input: true,
          promptId,
        }
        const prefix = { ...activity, transcript: before }
        const proof = new ClaudeJournalProof([start, activity, lateStop])
        expect(proof.covers(lateStop, prefix)).toBe(true)
        expect(proof.covers(lateStop, activity)).toBe(false)
      }
    }
    append({ type: 'user', uuid: 'new', promptId: 'q', message: { content: 'next turn' } })
    const next = append(assistant('new', 'q'))
    const nextStop = { ...stop, promptId: 'q' }
    expect(
      new ClaudeJournalProof([start, nextStop]).covers(nextStop, {
        ...fact('activity', 30),
        transcript: next,
        io: true,
        input: true,
        promptId: 'q',
      }),
    ).toBe(true)
  },
)
