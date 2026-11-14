import { afterEach, expect, it, vi } from 'vitest'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'

afterEach(() => vi.useRealTimers())
it('publishes startup Submit Stop immediately without creating a reconciliation timer', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const schedule = vi.fn((cb: () => void, ms: number) => {
    const timer = setTimeout(cb, ms)
    return () => clearTimeout(timer)
  })
  const owner = new ClaudeLiveConversation(schedule),
    published: string[] = []
  const ports = {
    reset: vi.fn(),
    invalidate: vi.fn(),
    ready: vi.fn(),
    canReady: () => false,
    settled: vi.fn(),
    completedTurnId: () => null,
  }
  try {
    for (const event of [
      { ...hook('A', 'SessionStart', 1), sessionStartSource: 'startup' },
      hook('A', 'UserPromptSubmit', 2),
      hook('A', 'Stop', 3),
    ]) {
      owner.accept(
        {
          conversation: {
            event,
            decide() {},
            publish: (_gen, action) => {
              if (action !== 'ignore') {
                published.push(event.hookEventName)
              }
            },
          },
        } as ClaudeTranscriptObservation,
        Date.now(),
        ports,
      )
    }
    expect(published).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop'])
    expect(Date.now()).toBe(100000)
    expect(schedule).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    owner.dispose()
  }
})
it('publishes idle completion and exact reply in the same tick on a steady entry', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture(),
    completed = vi.fn()
  f.registry.subscribe(
    { epoch: 'e', afterSeq: f.registry.list().seq },
    { types: ['agent.turn_completed'] },
    completed,
  )
  try {
    f.send(hook('A', 'UserPromptSubmit', 2))
    expect(f.fence().snapshot.state).toBe('working')
    f.send(hook('A', 'Stop', 3))
    expect(Date.now()).toBe(100000)
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      turn: null,
      lastEndedTurn: { id: 't1', outcome: 'completed' },
    })
    expect(completed).toHaveBeenCalledOnce()
    expect(f.registry.finalMessage({ nodeId: 'n', turnId: 't1' })).toMatchObject({
      message: 'reply-A',
    })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('publishes a steady permission wait immediately and clears the existing working lease', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send(hook('A', 'UserPromptSubmit', 2))
    f.send({ ...hook('A', 'PermissionRequest', 3), state: 'waiting' })
    expect(f.fence().snapshot).toMatchObject({
      state: 'waiting',
      quality: 'authoritative',
      turn: { id: 't1' },
    })
    expect(Date.now()).toBe(100000)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('ends the clear window at the first committed successor turn and immediately handles later turns', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'Stop', 25))
    expect(f.fence().snapshot.lastEndedTurn).toMatchObject({ id: 't1', outcome: 'completed' })
    expect(f.fence().conversationQuarantined).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    f.send({ ...hook('B', 'UserPromptSubmit', 30), promptId: 'second' })
    expect(f.fence().snapshot.state).toBe('working')
    f.send({ ...hook('B', 'Stop', 35), promptId: 'second' })
    expect(f.registry.finalMessage({ nodeId: 'n', turnId: 't2' })).toMatchObject({
      outcome: 'completed',
      message: 'reply-B',
    })
    expect(Date.now()).toBe(100000)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('preserves main ordinary End and late Stop projection without a reconciliation window', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send(hook('A', 'UserPromptSubmit', 2))
    f.send(hook('A', 'SessionEnd', 4))
    f.send(hook('A', 'Stop', 3))
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      turn: null,
      lastEndedTurn: { id: 't1', outcome: 'completed' },
    })
    expect(f.view().archive).toMatchObject([{ outcome: 'completed', message: 'reply-A' }])
    expect(Date.now()).toBe(100000)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
