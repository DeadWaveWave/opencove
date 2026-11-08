import { expect, it } from 'vitest'
import { continuationFixture as fixture, enqueue, dequeue } from './claudeTurnContinuation.helpers'

it.each([200, 1500, 3000])(
  'late queued user correlation requires terminal EOF after an early Stop decision delayed %i ms',
  delay => {
    const f = fixture(),
      completed: unknown[] = []
    f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.turn_completed'] }, e =>
      completed.push(e),
    )
    f.hook('UserPromptSubmit', 'A')
    f.record(enqueue)
    f.hook('Stop', 'A', 'intermediate')
    f.hook('Stop', 'B', 'ACK')
    f.tick(5001)
    expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded', turn: null })
    f.tick(delay)
    f.record(dequeue)
    f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
    expect(f.snapshot().state).toBe('unknown')
    f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { id: 't1', outcome: 'completed' },
    })
    expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toMatchObject({
      hookEventName: 'Stop',
    })
    expect(f.read()).toMatchObject({ turnId: 't1', message: 'ACK' })
    expect(completed).toHaveLength(1)
    f.runtime.dispose()
  },
)

it.each([200, 1500, 3000])(
  'early Stop reconciles with transcript records arriving %i ms later before the deadline',
  delay => {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A')
    f.record(enqueue)
    f.hook('Stop', 'A', 'first')
    f.hook('Stop', 'B', 'ACK')
    f.tick(delay)
    f.record(dequeue)
    f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { id: 't1' },
    })
    expect(f.read()).toMatchObject({ message: 'ACK' })
    f.runtime.dispose()
  },
)

it('transcript confirmation before the final Stop avoids the degraded path', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.tick(3000)
  f.hook('Stop', 'B', 'ACK')
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  f.runtime.dispose()
})

it.each(['before', 'after'])(
  'a late watcher baseline confirms an already observed follow-up Stop %s its deadline',
  timing => {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A')
    f.hook('UserPromptSubmit', 'A')
    f.hook('Stop', 'A', 'first')
    f.hook('Stop', 'B', 'ACK')
    if (timing === 'after') {
      f.tick(5001)
    }
    f.record(
      { kind: 'user', promptId: 'B', promptSource: 'queued' },
      { baseline: true, origin: 'hook' },
    )
    expect(f.snapshot().state).not.toBe('idle')
    f.record(
      { kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true },
      { baseline: true, origin: 'hook' },
    )
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { id: 't1' },
    })
    expect(f.read()).toMatchObject({ message: 'ACK' })
    f.runtime.dispose()
  },
)

it('baseline confirmation before the matching early Stop does not manufacture a start or end', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.hook('Stop', 'A', 'first')
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' }, { baseline: true })
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't1' }, lastEndedTurn: null })
  f.hook('Stop', 'B', 'ACK')
  expect(f.snapshot().state).not.toBe('idle')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    quality: 'authoritative',
    lastEndedTurn: { id: 't1' },
  })
  f.runtime.dispose()
})

it('a complete queue-empty final transcript checkpoint independently confirms the retained Stop', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'ACK')
  f.tick(5001)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'unknown' }, { baseline: true })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toMatchObject({
    hookEventName: 'Stop',
  })
  f.runtime.dispose()
})

it('missing records stay degraded regardless of elapsed time and reject mismatched or incomplete recovery evidence', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'ACK')
  f.tick(5001)
  f.tick(60_000)
  f.record({ kind: 'user', promptId: 'C', promptSource: 'queued' })
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: false, final: true })
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: false })
  f.record(
    { kind: 'user', promptId: 'B', promptSource: 'queued' },
    { providerSessionId: 'foreign' },
  )
  expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded' })
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})

it('new authoritative turns invalidate retained recovery evidence', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'ACK')
  f.tick(5001)
  f.hook('UserPromptSubmit', 'C')
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't2' } })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.runtime.dispose()
})

it('confirmed readiness survives subsequent transcript and coarse refreshes', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'ACK')
  f.tick(5001)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
  f.runtime.observe({ sessionId: 's', source: 'session_file', state: 'standby' })
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toMatchObject({
    hookEventName: 'Stop',
  })
  f.runtime.dispose()
})
