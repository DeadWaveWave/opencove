import { expect, it } from 'vitest'
import { continuationFixture as fixture, enqueue, dequeue } from './claudeTurnContinuation.helpers'

it('a delayed transcript batch never publishes recovery before its queue-empty terminal EOF', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'ACK')
  f.tick(5001)
  const states: string[] = []
  f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.state_changed'] }, () => {
    states.push(f.snapshot().state)
  })
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  expect(f.snapshot().state).toBe('unknown')
  f.record(enqueue)
  f.record({ kind: 'assistant', promptId: 'B', final: true })
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: false, final: true })
  expect(f.snapshot().state).toBe('unknown')
  expect(states).not.toContain('idle')
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.runtime.dispose()
})

it.each(['before', 'after'])(
  'a late continuation chain recovers at EOF when its Stop arrives %s its user record',
  timing => {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A')
    f.record(enqueue)
    f.hook('Stop', 'A', 'intermediate')
    f.tick(5001)
    if (timing === 'before') {
      f.hook('Stop', 'B', 'ACK')
    }
    f.record(dequeue)
    f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
    if (timing === 'after') {
      f.hook('Stop', 'B', 'ACK')
    }
    expect(f.snapshot().state).toBe('unknown')
    f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { id: 't1', outcome: 'unknown' },
    })
    expect(f.read({ turnId: 't1' })).toMatchObject({ outcome: 'unknown', message: 'intermediate' })
    expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toMatchObject({
      hookEventName: 'Stop',
    })
    f.runtime.dispose()
  },
)

it('a new provider generation retires a degraded chain and accepts a normal turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.tick(5001)
  f.record(undefined, { lifecycle: 'start', generation: 2, providerSessionId: 'next' })
  expect(f.snapshot().state).toBe('unknown')
  f.hook('UserPromptSubmit', 'C', undefined, undefined, 'next')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't2' } })
  f.hook('Stop', 'C', 'complete', undefined, 'next')
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  f.record({ kind: 'checkpoint', promptId: 'A', queueEmpty: true, final: true })
  expect(f.read()).toMatchObject({ message: 'complete' })
  f.runtime.dispose()
})
it('a late correlated Stop watermark rejects earlier chain replays until terminal EOF', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' }, { reading: true })
  f.hook('Stop', 'B', 'second', 300)
  f.record(enqueue, { reading: true })
  f.hook('Stop', 'A', 'old', 250)
  f.hook('Stop', 'B', 'replay', 300)
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: false, final: true })
  expect(f.snapshot().state).toBe('unknown')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'C', promptSource: 'queued' })
  f.hook('Stop', 'C', 'final', 400)
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'C', queueEmpty: true, final: true })
  expect(f.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  f.runtime.dispose()
})
it('even a newer correlated lifecycle Stop cannot publish readiness inside a transcript read', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.record({ kind: 'assistant', promptId: 'A', final: true }, { reading: true })
  f.hook('Stop', 'A', 'newer', 201)
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'A', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})
it('registry polling demand survives a timeout and ends only on reconciled recovery', () => {
  const f = fixture(),
    demand: boolean[] = []
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue, { setPollingDemand: needed => demand.push(needed) })
  expect(demand.at(-1)).toBe(true)
  f.hook('Stop', 'A', 'first')
  f.tick(5001)
  expect(demand.at(-1)).toBe(true)
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.hook('Stop', 'B', 'final')
  expect(demand.at(-1)).toBe(true)
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
  expect(demand.at(-1)).toBe(false)
  f.runtime.dispose()
})
it('an unavailable transcript retains an already buffered follow-up Stop for later EOF recovery', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.hook('Stop', 'B', 'second', 300)
  f.record(undefined, { unavailable: true })
  expect(f.snapshot()).toMatchObject({ state: 'unknown', lastEndedTurn: { outcome: 'unknown' } })
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
  expect(f.snapshot()).toMatchObject({ state: 'idle', lastEndedTurn: { outcome: 'unknown' } })
  f.runtime.dispose()
})
it('late chain correlation never moves the retained relay watermark backwards', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.hook('Stop', 'C', 'third', 250)
  f.hook('Stop', 'B', 'second', 300)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.record({ kind: 'user', promptId: 'C', promptSource: 'queued' })
  f.hook('Stop', 'C', 'older replay', 260)
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'C', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})
it.each(['incarnation', 'source_freshness', 'degraded'])(
  'late Stop buffering retains the registry %s fence',
  invalid => {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A', undefined, 100)
    f.record(enqueue)
    f.hook('Stop', 'A', 'first', 200)
    f.tick(5001)
    f.registry.observe(
      's',
      {
        incarnation: invalid === 'incarnation' ? 'retired-X' : 's',
        source: 'claude_hook',
        observedAt: invalid === 'source_freshness' ? 100 : 100000,
        sourceSequence: 100,
        state: 'idle',
        degraded: invalid === 'degraded',
        hookEventName: 'Stop',
        boundary: { kind: 'end', outcome: 'completed' },
        emittedAtMs: 300,
      },
      { promptId: 'B', providerSessionId: 'provider' },
    )
    f.record(dequeue)
    f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
    f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: true, final: true })
    expect(f.snapshot().state).toBe('unknown')
    f.runtime.dispose()
  },
)
