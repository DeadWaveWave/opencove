import { expect, it } from 'vitest'
import { ClaudeTranscriptCheckpoint } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptCheckpoint'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

it('a terminal assistant parented by the stopped prompt and an empty queue produce positive EOF evidence', () => {
  const state = new ClaudeTranscriptCheckpoint()
  for (const record of [
    { type: 'queue-operation', operation: 'enqueue' },
    { type: 'queue-operation', operation: 'dequeue' },
    { type: 'user', promptId: 'B', uuid: 'user-b' },
    {
      type: 'assistant',
      parentUuid: 'user-b',
      message: { stop_reason: 'end_turn', content: 'private' },
    },
  ]) {
    state.observe(parseClaudeTranscript(JSON.stringify(record)))
  }
  expect(state.read(true)).toEqual({
    kind: 'checkpoint',
    promptId: 'B',
    queueEmpty: true,
    final: true,
  })
  expect(state.read(false)).toMatchObject({ final: false })
})

it.each(['queued', 'unknown', 'new-user', 'new-assistant', 'wrong-parent'])(
  'checkpoint refuses readiness when evidence is %s',
  condition => {
    const state = new ClaudeTranscriptCheckpoint()
    state.observe({ kind: 'user', promptId: 'B', uuid: 'b', promptSource: 'unknown' })
    state.observe({
      kind: 'assistant',
      parentUuid: condition === 'wrong-parent' ? 'old' : 'b',
      final: true,
    })
    if (condition === 'queued') {
      state.observe({ kind: 'queue', operation: 'enqueue' })
    }
    if (condition === 'unknown') {
      state.observe({ kind: 'queue', operation: 'unknown' })
    }
    if (condition === 'new-user') {
      state.observe({ kind: 'user', promptId: 'C', promptSource: 'typed' })
    }
    if (condition === 'new-assistant') {
      state.observe({ kind: 'assistant', parentUuid: 'b', final: false })
    }
    const checkpoint = state.read(true)
    expect(
      checkpoint.kind === 'checkpoint' &&
        checkpoint.promptId === 'B' &&
        checkpoint.queueEmpty &&
        checkpoint.final,
    ).toBe(false)
  },
)
it('malformed queue candidates and invalid file bytes cannot prove an empty checkpoint', () => {
  const state = new ClaudeTranscriptCheckpoint()
  state.observe({ kind: 'user', promptId: 'B', uuid: 'b', promptSource: 'queued' })
  state.observe({ kind: 'assistant', parentUuid: 'b', final: true })
  state.observe(parseClaudeTranscript('{malformed}'))
  expect(state.read(true)).toMatchObject({ queueEmpty: false })
  state.invalidate()
  expect(state.read(true)).toMatchObject({ queueEmpty: false, final: false })
})
it.each([{}, { promptId: 'invalid id' }, { promptId: 1 }])(
  'an unsupported main-chain user invalidates prior final identity: %j',
  fields => {
    const state = new ClaudeTranscriptCheckpoint()
    state.observe({ kind: 'user', promptId: 'B', uuid: 'b', promptSource: 'queued' })
    state.observe({ kind: 'assistant', parentUuid: 'b', final: true })
    state.observe(parseClaudeTranscript(JSON.stringify({ type: 'user', ...fields })))
    expect(state.read(true)).toMatchObject({ promptId: undefined, final: false })
  },
)
