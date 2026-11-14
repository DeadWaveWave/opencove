import { afterEach, expect, it, vi } from 'vitest'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('keeps the namespace fence after the quiet window until a fresh Start accepts the next identity', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(200)
    const owner = vi.spyOn(ClaudeLiveConversation.prototype, 'accept')
    f.send(hook('C', 'UserPromptSubmit', 20))
    expect(f.fence()).toMatchObject({
      claudeClearReady: false,
      conversationQuarantined: true,
      snapshot: { state: 'unknown', turn: null },
    })
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe('B')
    f.send({ ...hook('C', 'SessionStart', 15), sessionStartSource: 'resume' })
    f.send(hook('C', 'UserPromptSubmit', 20))
    expect(f.fence().snapshot.state).toBe('working')
    expect(owner).toHaveBeenCalledTimes(2)
  } finally {
    f.registry.dispose()
  }
})
it('keeps ordinary resume history below saturation and preserves reused IDs', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    for (let i = 0; i < 66; i++) {
      f.send({ ...hook(`R${i}`, 'SessionStart', 10 + i), sessionStartSource: 'resume' })
    }
    expect(f.fence().conversationGeneration).toBeUndefined()
    f.send(hook('B', 'SessionStart', 100))
    vi.advanceTimersByTime(200)
    expect(f.fence()).toMatchObject({ claudeClearReady: true, conversationQuarantined: false })
    f.send(hook('B', 'UserPromptSubmit', 110))
    f.send(hook('B', 'Stop', 120))
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      lastEndedTurn: { outcome: 'completed' },
    })
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
    f.send(hook('R0', 'SessionStart', 200))
    vi.advanceTimersByTime(201)
    expect(f.fence().claudeClearReady).toBe(false)
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).not.toBeNull()
    f.send({ ...hook('R0', 'UserPromptSubmit', 210), promptId: 'reused' })
    f.send({ ...hook('R0', 'Stop', 220), promptId: 'reused' })
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('processes ordinary hooks immediately while retaining the namespace fence after a clear turn', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(200)
    expect(f.fence().claudeClearReady).toBe(true)
    const owner = vi.spyOn(ClaudeLiveConversation.prototype, 'accept')
    f.send(hook('B', 'UserPromptSubmit', 20))
    f.send(hook('B', 'Stop', 25))
    expect(owner).not.toHaveBeenCalled()
    expect(f.fence().snapshot.lastEndedTurn?.outcome).toBe('completed')
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe('B')
    const capture = vi.fn()
    f.registry.observeClaudeTranscript('s', 'i', {
      sessionId: 's',
      incarnation: 'i',
      providerSessionId: 'B',
      generation: 1,
      position: -1,
      baseline: true,
      fileIdentity: 'capture',
      captureConversation: capture,
    })
    expect(capture).toHaveBeenCalledWith(f.fence().conversationGeneration, 'i')
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        providerSessionId: 'A',
        conversationGeneration: 900,
      }),
    ).toBe(false)
    f.send({ ...hook('A', 'SessionStart', 30), sessionStartSource: 'resume' })
    f.send({ ...hook('A', 'UserPromptSubmit', 40), promptId: 'after-clear' })
    f.send({ ...hook('A', 'Stop', 50), promptId: 'after-clear' })
    expect(f.fence().snapshot.lastEndedTurn?.outcome).toBe('completed')
    expect(owner).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
