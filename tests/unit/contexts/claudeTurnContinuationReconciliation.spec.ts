import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import {
  continuationFixture as fixture,
  enqueue,
  dequeue,
  queued,
} from './claudeTurnContinuation.helpers'

it('missing transcript evidence ends unknown without granting readiness from its deadline', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.hook('Stop', 'A', 'last reply')
  f.tick(5001)
  expect(f.snapshot()).toMatchObject({
    state: 'unknown',
    quality: 'degraded',
    turn: null,
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  expect(f.read()).toMatchObject({
    outcome: 'unknown',
    message: 'last reply',
    messageKind: 'intermediate',
  })
  f.hook('Stop', 'A', 'authoritative reply')
  expect(f.snapshot().state).toBe('idle')
  f.runtime.dispose()
})

it('unavailable transcript evidence degrades a pending continuation immediately', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'last reply')
  f.record(undefined, { unavailable: true })
  expect(f.snapshot()).toMatchObject({ state: 'unknown', turn: null, quality: 'degraded' })
  expect(f.read()).toMatchObject({ outcome: 'unknown', messageKind: 'intermediate' })
  f.runtime.dispose()
})

it('baseline transcript replay never creates a live queued continuation', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue, { baseline: true })
  f.record(dequeue, { baseline: true })
  f.record(queued, { baseline: true })
  f.hook('Stop', 'A', 'final')
  expect(f.read()).toMatchObject({ turnId: 't1', outcome: 'completed', message: 'final' })
  f.runtime.dispose()
})

it('record positions deduplicate replay and older watcher generations cannot consume queue items', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue, { generation: 2, position: 1 })
  f.record(enqueue, { generation: 2, position: 1 })
  f.hook('Stop', 'A', 'first')
  f.record(dequeue, { generation: 1, position: 10 })
  f.record(queued, { generation: 1, position: 11 })
  expect(f.snapshot().turn?.id).toBe('t1')
  f.record(dequeue, { generation: 2, position: 2 })
  f.record(queued, { generation: 2, position: 3 })
  f.hook('Stop', queued.kind === 'user' ? queued.promptId : '', 'final')
  expect(f.read()).toMatchObject({ message: 'final', outcome: 'completed' })
  f.runtime.dispose()
})

it('watcher file replacement with unresolved items ends unknown rather than replaying the new baseline', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue, { fileIdentity: 'replacement', baseline: true, position: 1 })
  expect(f.read()).toMatchObject({ outcome: 'unknown', message: 'first' })
  f.runtime.dispose()
})

it('unknown queue operations and bounded queue overflow retain uncertainty', () => {
  for (const overflow of [false, true]) {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A')
    if (overflow) {
      for (let i = 0; i < 65; i++) {
        f.record(enqueue)
      }
    } else {
      f.record({ kind: 'queue', operation: 'unknown' })
    }
    f.hook('Stop', 'A', 'first')
    f.tick(5001)
    expect(f.read()).toMatchObject({ outcome: 'unknown', messageKind: 'intermediate' })
    expect(f.snapshot()).toMatchObject({ state: 'unknown', turn: null })
    f.runtime.dispose()
  }
})

it('one pending continuation can correlate an early Stop without its user record but cannot become ready by timer', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'final')
  f.tick(5001)
  expect(f.read()).toMatchObject({
    turnId: 't1',
    promptId: 'B',
    message: 'final',
    outcome: 'completed',
  })
  expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded', turn: null })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.runtime.dispose()
})

it('multiple pending continuations do not guess the identity of an early Stop', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('Stop', 'B', 'unattributed')
  f.tick(5001)
  expect(f.read()).toMatchObject({
    outcome: 'unknown',
    message: 'first',
    messageKind: 'intermediate',
  })
  f.runtime.dispose()
})

it('fresh distinct submission supersedes a pending continuation with the existing unknown outcome rule', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.hook('UserPromptSubmit', 'C', undefined, 200)
  expect(f.snapshot()).toMatchObject({
    state: 'working',
    turn: { id: 't2' },
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  f.hook('Stop', 'A', 'late')
  f.hook('Stop', 'C', 'new final')
  expect(f.read()).toMatchObject({ turnId: 't2', message: 'new final' })
  f.runtime.dispose()
})

it('continuation keeps original relay freshness for distinct human submissions without inventing timestamps', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.hook('UserPromptSubmit', 'C', undefined, 99)
  expect(f.snapshot().turn?.id).toBe('t1')
  f.hook('UserPromptSubmit', 'C', undefined, 200)
  expect(f.snapshot().turn?.id).toBe('t2')
  f.runtime.dispose()
})

it('history and completion payloads are committed atomically before reentrant subscribers start a new turn', () => {
  const f = fixture(),
    completions: unknown[] = []
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.registry.watchFence(f.registry.readFence({ sessionId: 's' })!, receipt => {
    if (receipt.fence?.snapshot.lastEndedTurn?.id === 't1' && !receipt.fence.snapshot.turn) {
      expect(f.read({ turnId: 't1' })).toMatchObject({ message: 'final' })
      f.hook('UserPromptSubmit', 'C')
    }
  })
  f.registry.subscribe(
    { epoch: 'e', afterSeq: f.registry.list().seq },
    { types: ['agent.turn_completed'] },
    event => completions.push(event),
  )
  f.hook('Stop', 'B', 'final')
  expect(completions).toEqual([
    expect.objectContaining({
      snapshot: expect.objectContaining({
        turn: null,
        lastEndedTurn: expect.objectContaining({ id: 't1' }),
      }),
    }),
  ])
  expect(f.snapshot()).toMatchObject({
    turn: { id: 't2' },
    lastEndedTurn: { id: 't1', outcome: 'completed' },
  })
  f.runtime.dispose()
})

it('exit, replacement and disposal cancel pending continuation deadlines', () => {
  for (const action of ['exit', 'replace', 'dispose']) {
    const f = fixture()
    f.hook('UserPromptSubmit', 'A')
    f.record(enqueue)
    f.hook('Stop', 'A', 'first')
    if (action === 'exit') {
      f.runtime.exit('s')
    }
    if (action === 'replace') {
      f.registry.register({ sessionId: 's', incarnation: 'new', provider: 'claude-code' })
    }
    if (action === 'dispose') {
      f.registry.dispose()
    }
    f.tick(5001)
    expect(f.timers.size).toBe(0)
    if (action === 'replace') {
      expect(f.snapshot()).toMatchObject({ state: 'unknown', turn: null, lastEndedTurn: null })
    }
    f.runtime.dispose()
  }
})

it('delayed original prompt submissions cannot supersede an attached provider continuation', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.hook('UserPromptSubmit', 'A', undefined, 300)
  f.hook('Stop', 'A', 'late')
  expect(f.snapshot()).toMatchObject({ turn: { id: 't1' }, lastEndedTurn: null })
  f.hook('Stop', 'B', 'final')
  expect(f.read()).toMatchObject({ turnId: 't1', message: 'final' })
  f.runtime.dispose()
})

it('same-ID receipts reach listeners while permission state and relay freshness remain unchanged', () => {
  const f = fixture(),
    receipts: unknown[] = []
  f.hook('UserPromptSubmit', 'A', undefined, 100)
  f.hook('PermissionRequest', 'A')
  const waiting = f.snapshot()
  f.registry.watchFence(f.registry.readFence({ sessionId: 's' })!, receipt =>
    receipts.push(receipt),
  )
  f.hook('UserPromptSubmit', 'A', undefined, 300)
  expect(f.snapshot()).toEqual(waiting)
  expect(receipts).toContainEqual(
    expect.objectContaining({ hookEventName: 'UserPromptSubmit', turnId: 't1' }),
  )
  f.hook('UserPromptSubmit', 'B', undefined, 200)
  expect(f.snapshot().turn?.id).toBe('t2')
  f.runtime.dispose()
})

it('PostToolUse cannot consume a queued item without transcript removal evidence', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('PostToolUse', 'A')
  f.hook('Stop', 'A', 'first')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: { id: 't1' }, lastEndedTurn: null })
  f.runtime.dispose()
})

it('queued user records observed before the provider Stop attach only after that Stop', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  f.hook('Stop', 'A', 'first')
  expect(f.snapshot().turn?.id).toBe('t1')
  f.hook('Stop', 'B', 'final')
  expect(f.read()).toMatchObject({ turnId: 't1', message: 'final', outcome: 'completed' })
  f.runtime.dispose()
})

it('unavailability without queue evidence does not invent a continuation for an ordinary turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(undefined, { unavailable: true })
  f.hook('Stop', 'A', 'final')
  expect(f.read()).toMatchObject({ outcome: 'completed', message: 'final' })
  f.runtime.dispose()
})

it('retained provider IDs cannot enter the unmatched Stop buffer for a later turn', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'old')
  f.hook('Stop', 'old', 'old final')
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'current intermediate')
  f.hook('Stop', 'old', 'replayed final')
  f.tick(5001)
  expect(f.read()).toMatchObject({
    turnId: 't2',
    message: 'current intermediate',
    outcome: 'unknown',
  })
  f.runtime.dispose()
})

it('queue removal cannot publish an old final reply when an unmatched provider Stop contradicts it', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.hook('Stop', 'B', 'unattributed')
  f.record({ kind: 'queue', operation: 'remove' })
  expect(f.read()).toMatchObject({
    outcome: 'unknown',
    message: 'intermediate',
    messageKind: 'intermediate',
  })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.runtime.dispose()
})

it('coarse file refreshes cannot restore readiness after uncertain continuation expiry', () => {
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.tick(5001)
  f.runtime.observe({ sessionId: 's', source: 'session_file', state: 'standby' })
  expect(f.snapshot()).toMatchObject({ state: 'unknown', quality: 'degraded', turn: null })
  expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  f.hook('Stop', 'A', 'fresh')
  expect(f.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' })
  f.runtime.dispose()
})

it.each(['p', 'different'])(
  'correlates B baseline continuation when A ended prompt is %s',
  predecessor => {
    const f = fixture()
    f.hook('UserPromptSubmit', predecessor, undefined, undefined, 'A')
    f.hook('Stop', predecessor, 'reply-A', undefined, 'A')
    // Provider-scoped prompt history belongs to an authenticated clear, not ordinary resume.
    f.runtime.observeClaudeTranscript({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: 'B',
      generation: 0,
      fileIdentity: '',
      position: -1,
      baseline: false,
      conversation: {
        event: {
          claudeSessionId: 'B',
          hookEventName: 'SessionStart',
          sessionStartSource: 'clear',
          emittedAtMs: 200,
          state: null,
        },
        decide() {},
        publish() {},
      },
    })
    f.tick(200)
    expect(f.registry.readFence({ sessionId: 's' })?.conversationGeneration).toBeTypeOf('number')
    f.hook('UserPromptSubmit', 'b-first', undefined, undefined, 'B')
    f.hook('UserPromptSubmit', 'b-first', undefined, undefined, 'B')
    f.hook('Stop', 'b-first', 'intermediate-B', undefined, 'B')
    const user = JSON.parse(
      readFileSync('tests/fixtures/claude/clear-successor-2.1.321.jsonl', 'utf8')
        .trim()
        .split('\n')[6],
    )
    f.record(parseClaudeTranscript(JSON.stringify({ ...user, promptSource: 'queued' })), {
      baseline: true,
      providerSessionId: 'B',
      origin: 'hook',
    })
    f.hook('Stop', 'p', 'final-B', undefined, 'B')
    f.record(
      { kind: 'checkpoint', promptId: 'p', queueEmpty: true, final: true },
      { providerSessionId: 'B', origin: 'hook' },
    )
    expect(f.read({ turnId: 't2' })).toMatchObject({
      message: 'final-B',
      outcome: 'completed',
      turnId: 't2',
    })
    expect(f.read({ turnId: 't1' })).toMatchObject({ message: 'reply-A', outcome: 'completed' })
    f.runtime.dispose()
  },
)
