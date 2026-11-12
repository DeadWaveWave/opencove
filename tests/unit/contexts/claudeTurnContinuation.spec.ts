import { expect, it } from 'vitest'
import {
  continuationFixture as fixture,
  enqueue,
  dequeue,
  queued,
  toolRecords,
} from './claudeTurnContinuation.helpers'

it('queued follow-up keeps the current OpenCove turn working at the first provider Stop', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  const turn = f.snapshot().turn
  f.hook('UserPromptSubmit', 'A')
  f.hook('Stop', 'A', 'intermediate')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn, lastEndedTurn: null })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
})

it('same-ID submission preserves a permission wait and its original turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.hook('PermissionRequest', 'A')
  const waiting = f.snapshot()
  f.hook('UserPromptSubmit', 'A')
  expect(f.snapshot()).toEqual(waiting)
})

it('text-only queued continuation retains one turn and stores only the final reply', () => {
  const f = fixture(),
    events: unknown[] = []
  f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.turn_completed'] }, e =>
    events.push(e),
  )
  f.hook('UserPromptSubmit', 'A')
  const turn = f.snapshot().turn
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.hook('Notification', 'A')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn, lastEndedTurn: null })
  expect(() => f.read({ turnId: 't1' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_ended' } }),
  )
  f.record(dequeue)
  f.record(queued)
  f.hook('Stop', queued.kind === 'user' ? queued.promptId : '', 'final')
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    turn: null,
    lastEndedTurn: { id: 't1', outcome: 'completed' },
  })
  expect(f.read({ turnId: 't1' })).toMatchObject({ message: 'final', turnId: 't1' })
  expect(f.read({ promptId: 'A' })).toMatchObject({ message: 'final', turnId: 't1' })
  expect(events).toHaveLength(1)
  expect(JSON.stringify(events)).not.toContain('intermediate')
  expect(JSON.stringify(events)).not.toContain('final')
  f.runtime.dispose()
})

it('tool-boundary removal consumes the queue inside one provider turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.record(toolRecords.find(r => r.kind === 'queue' && r.operation === 'enqueue'))
  f.hook('PostToolUse', 'A')
  f.record(toolRecords.find(r => r.kind === 'queue' && r.operation === 'remove'))
  f.hook('Stop', 'A', 'tool final')
  expect(f.read()).toMatchObject({ message: 'tool final', turnId: 't1', outcome: 'completed' })
  f.runtime.dispose()
})

it('queued provider Stop arriving before its user record reconciles without publishing idle', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  const id = queued.kind === 'user' ? queued.promptId : ''
  f.hook('Stop', id, 'final')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't1' }, lastEndedTurn: null })
  f.record(dequeue)
  f.record(queued)
  expect(f.read()).toMatchObject({ message: 'final', turnId: 't1' })
  f.runtime.dispose()
})

it('two queued items preserve multiplicity even when their text is identical', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.record(enqueue)
  f.hook('UserPromptSubmit', 'A')
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptSource: 'queued', promptId: 'B' })
  f.hook('Stop', 'B', 'second')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't1' }, lastEndedTurn: null })
  f.record(dequeue)
  f.record({ kind: 'user', promptSource: 'queued', promptId: 'C' })
  f.hook('StopFailure', 'C', 'third')
  expect(f.read()).toMatchObject({ message: 'third', turnId: 't1', outcome: 'failed' })
  f.runtime.dispose()
})

it('new messages queued during a continuation stay in the same OpenCove turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptSource: 'queued', promptId: 'B' })
  f.hook('UserPromptSubmit', 'B')
  f.record(enqueue)
  f.hook('Stop', 'B', 'second')
  f.record(dequeue)
  f.record({ kind: 'user', promptSource: 'queued', promptId: 'C' })
  f.hook('Stop', 'C', 'third')
  expect(f.read()).toMatchObject({ message: 'third', turnId: 't1' })
  f.runtime.dispose()
})

it('queue removal without follow-up ends with the retained provider reply after reconciliation', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'answer')
  f.record({
    kind: 'queue',
    operation: 'remove',
    key: enqueue.kind === 'queue' ? enqueue.key : undefined,
  })
  expect(f.snapshot().turn).toBeNull()
  expect(f.read()).toMatchObject({ message: 'answer', outcome: 'completed', turnId: 't1' })
  f.runtime.dispose()
})

it('dequeue without a user record expires as unknown with an intermediate reply', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'answer')
  f.record(dequeue)
  f.tick(5001)
  expect(f.read()).toMatchObject({
    message: 'answer',
    outcome: 'unknown',
    messageKind: 'intermediate',
  })
  expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded', turn: null })
  f.runtime.dispose()
})
