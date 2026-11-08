import { expect, it } from 'vitest'
import { continuationFixture as fixture, enqueue, dequeue } from './claudeTurnContinuation.helpers'

it('an uncertain end retains unresolved multiplicity and cannot recover from a baseline user alone', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.record(enqueue)
  f.hook('Stop', 'B', 'intermediate')
  f.tick(5001)
  f.record(
    { kind: 'user', promptId: 'B', promptSource: 'queued' },
    { baseline: true, generation: 2 },
  )
  expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded' })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.runtime.dispose()
})
it.each([false, true])(
  'equal or older intermediate Stop relay timestamps cannot clear the degraded latch (older=%s)',
  older => {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A', undefined, 100)
    f.record(enqueue)
    f.hook('Stop', 'A', 'intermediate', 200)
    f.tick(5001)
    f.hook('Stop', 'A', 'replayed', older ? 199 : 200)
    expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded' })
    expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
    f.runtime.dispose()
  },
)
it('uncertain ends require reconciled terminal EOF rather than user-only correlation', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.tick(5001)
  f.record({ kind: 'user', promptId: 'A', promptSource: 'queued' })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'A', queueEmpty: true, final: true })
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})
it('a genuinely newer correlated Stop can restore readiness without accepting a newer unrelated Stop', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first', 200)
  f.tick(5001)
  f.hook('Stop', 'foreign', 'unrelated', 201)
  expect(f.snapshot().state).toBe('unknown')
  f.hook('Stop', 'A', 'new evidence', 201)
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  f.runtime.dispose()
})
it('a queued item after a unique fallback prevents terminal recovery', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'second')
  f.tick(5001)
  f.record(enqueue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  expect(f.snapshot().state).toBe('unknown')
  f.record({ kind: 'checkpoint', promptId: 'B', queueEmpty: false, final: true })
  expect(f.snapshot().state).toBe('unknown')
  f.runtime.dispose()
})
it('stale originating incarnations cannot contaminate a replacement using the same provider session', () => {
  const f = fixture()
  f.record(enqueue, { incarnation: 'retired-X', origin: 'hook' })
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue, { incarnation: 'retired-X', origin: 'hook' })
  f.hook('Stop', 'A', 'final')
  expect(f.snapshot()).toMatchObject({ state: 'idle', turn: null })
  f.runtime.dispose()
})
it('replacement terminal invocation Y ignores records captured by X even with the same provider session', () => {
  const f = fixture()
  const metadata = (invocationId: string, generation: number) =>
    f.runtime.metadata({
      sessionId: 's',
      agentProvider: 'claude-code',
      resumeSessionId: 'provider',
      terminalAgentActivity: {
        provider: 'claude-code',
        invocationId,
        generation,
        phase: 'active',
        observedAtMs: 100,
        identityAuthority: 'provider_session_start',
      },
    })
  metadata('X', 1)
  f.hook('UserPromptSubmit', 'old')
  metadata('Y', 2)
  f.hook('UserPromptSubmit', 'current')
  f.record(enqueue, { incarnation: 'X', origin: 'hook' })
  f.hook('Stop', 'current', 'final')
  expect(f.snapshot()).toMatchObject({ state: 'idle', turn: null })
  f.runtime.dispose()
})
