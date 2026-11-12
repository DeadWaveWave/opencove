import { afterEach, expect, it, vi } from 'vitest'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('withdraws an empty clear receipt for new ordinary activity after the quiet window', () => {
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
      conversationQuarantined: false,
      snapshot: { state: 'working' },
    })
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe('C')
    expect(owner).not.toHaveBeenCalled()
  } finally {
    f.registry.dispose()
  }
})
it('restricts only clear readiness when retired identity retention saturates', () => {
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
    expect(f.fence()).toMatchObject({ claudeClearReady: false, conversationQuarantined: false })
    f.send(hook('B', 'UserPromptSubmit', 110))
    f.send(hook('B', 'Stop', 120))
    expect(f.fence().snapshot).toMatchObject({
      state: 'idle',
      lastEndedTurn: { outcome: 'completed' },
    })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.registry.dispose()
  }
})
it('returns to main identity, capture and observation after a settled clear completes its first turn', () => {
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
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBeUndefined()
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
    expect(capture).toHaveBeenCalledWith(undefined, 'i')
    expect(
      f.registry.acceptsObservation('s', 'session_file', {
        providerSessionId: 'A',
        conversationGeneration: 900,
      }),
    ).toBe(true)
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
