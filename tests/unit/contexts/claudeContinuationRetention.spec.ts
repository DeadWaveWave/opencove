import { expect, it } from 'vitest'
import { continuationFixture, enqueue, dequeue } from './claudeTurnContinuation.helpers'

it('historical baseline queued identities cannot crowd out the actual follow-up EOF candidate', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.tick(5001)
  f.hook('Stop', 'B', 'final B')
  for (let n = 0; n < 80; n++) {
    f.record(
      { kind: 'user', promptId: `historical-${n}`, promptSource: 'queued' },
      { baseline: true },
    )
  }
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' }, { baseline: true })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  f.runtime.dispose()
})
it.each(['before', 'after'])(
  'resolved segments roll out of a long recovery chain when Stops arrive %s users',
  order => {
    const f = continuationFixture()
    f.hook('UserPromptSubmit', 'A')
    f.record(enqueue)
    f.hook('Stop', 'A', 'first')
    f.tick(5001)
    for (let n = 0; n < 80; n++) {
      const id = `segment-${n}`
      if (n) {
        f.record(enqueue)
      }
      if (order === 'before') {
        f.hook('Stop', id, 'intermediate')
      }
      f.record(dequeue)
      f.record({ kind: 'user', promptId: id, promptSource: 'queued' })
      if (order === 'after') {
        f.hook('Stop', id, 'intermediate')
      }
    }
    expect(f.snapshot().state).toBe('unknown')
    f.record({ kind: 'checkpoint', promptId: 'segment-79', queueEmpty: true, final: true })
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { outcome: 'unknown' },
    })
    expect(f.read({ turnId: 't1' })).toMatchObject({ outcome: 'unknown', message: 'first' })
    f.runtime.dispose()
  },
)
it('live baseline correlation rolls history out before the matching early Stop arrives', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  for (let n = 0; n < 80; n++) {
    f.record(
      { kind: 'user', promptId: `historical-${n}`, promptSource: 'queued' },
      { baseline: true },
    )
  }
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' }, { baseline: true })
  f.hook('Stop', 'B', 'final B')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't1', outcome: 'completed' },
  })
  expect(f.read()).toMatchObject({ message: 'final B' })
  f.runtime.dispose()
})
it('resolved queue occurrences roll out during a long active continuation without ending its turn', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A')
  let current = 'A'
  for (let n = 0; n < 80; n++) {
    f.record(enqueue)
    f.hook('Stop', current, 'intermediate')
    f.record(dequeue)
    current = `segment-${n}`
    f.record({ kind: 'user', promptId: current, promptSource: 'queued' })
  }
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't1' }, lastEndedTurn: null })
  f.hook('Stop', current, 'final reply')
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't1', outcome: 'completed' },
  })
  expect(f.read()).toMatchObject({ message: 'final reply' })
  f.runtime.dispose()
})
it('unmatched Stops survive rolling eviction of resolved correlations', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.hook('Stop', 'B', 'final B', 300)
  for (let n = 0; n < 100; n++) {
    const id = `resolved-${n}`
    f.hook('Stop', id, 'intermediate', 400 + n)
    f.record({ kind: 'user', promptId: id, promptSource: 'queued' }, { baseline: true })
  }
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' }, { baseline: true })
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot()).toMatchObject({ state: 'idle', lastEndedTurn: { outcome: 'unknown' } })
  f.runtime.dispose()
})
it('the current EOF candidate survives unmatched Stop pressure without evicting older uncorrelated Stops', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  for (let n = 0; n < 64; n++) {
    f.hook('Stop', `pending-${n}`, 'reply', 300 + n)
  }
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.hook('Stop', 'B', 'final B', 500)
  f.hook('Stop', 'pending-0', 'replayed unrelated', 600)
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})
it('rolling recovery collections stay bounded and discard final-message content', async () => {
  const { ClaudeContinuationRecovery } =
    await import('../../../src/contexts/agent/application/ClaudeContinuationRecovery')
  type End = import('../../../src/contexts/agent/application/ClaudeTurnContinuation').ProviderEnd
  const end = (promptId: string, emittedAtMs: number): End => ({
    observation: {
      incarnation: 's',
      source: 'claude_hook',
      observedAt: emittedAtMs,
      emittedAtMs,
      sourceSequence: emittedAtMs,
      state: 'idle',
      hookEventName: 'Stop',
      boundary: { kind: 'end', outcome: 'completed' },
    },
    evidence: {
      promptId,
      providerSessionId: 'provider',
      finalMessage: { message: 'private reply', truncated: false },
    },
  })
  const recovery = new ClaudeContinuationRecovery()
  recovery.remember('t1', end('A', 100), { reason: 'unresolved_queue', unresolved: 1 })
  const state = recovery as unknown as {
    ticket: { users: Set<string>; stops: Map<string, { end: End; correlated: boolean }> }
  }
  for (let n = 0; n < 1000; n++) {
    const id = `segment-${n}`
    recovery.captureEnd(end(id, 101 + n))
    recovery.observe({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: 'provider',
      fileIdentity: 'file',
      generation: 1,
      position: n + 1,
      baseline: false,
      record: { kind: 'user', promptId: id, promptSource: 'queued' },
    })
    expect(state.ticket.users.size).toBeLessThanOrEqual(64)
    expect(state.ticket.stops.size).toBeLessThanOrEqual(64)
    expect(state.ticket.users.has(id)).toBe(true)
  }
  expect(
    [...state.ticket.stops.values()].every(
      value => value.correlated && !value.end.evidence?.finalMessage,
    ),
  ).toBe(true)
})
it('retention of an EOF candidate does not qualify an unidentified submission as queued', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.tick(5001)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'unknown' }, { baseline: true })
  f.hook('Stop', 'B', 'foreign reply')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true }, { baseline: true })
  expect(f.snapshot().state).toBe('unknown')
  f.runtime.dispose()
})
it('a retained historical Stop cannot lower the replay fence for the current EOF candidate', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.hook('Stop', 'B', 'second', 300)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.record(enqueue)
  f.hook('Stop', 'C', 'third', 400)
  f.record({ kind: 'user', promptId: 'C', promptSource: 'queued' })
  f.hook('Stop', 'B', 'retained newer evidence', 500)
  f.hook('Stop', 'C', 'older replay', 450)
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'C', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})
