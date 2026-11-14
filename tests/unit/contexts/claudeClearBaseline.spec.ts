import { afterEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

afterEach(() => vi.useRealTimers())
it('rejects stale Stop before releasing the clear generation-start barrier', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture()
  try {
    f.send({ ...hook('B', 'SessionStart', 2), sessionStartSource: 'resume' })
    f.send({ ...hook('B', 'UserPromptSubmit', 3), promptId: 'old' })
    f.send({ ...hook('B', 'Stop', 4), promptId: 'old' })
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(200)
    const generation = f.fence().conversationGeneration
    const stop = (sequence: number, promptId: string, observedAt = Date.now()) =>
      f.registry.observe(
        's',
        {
          incarnation: 'i',
          source: 'claude_hook',
          sourceSequence: sequence,
          observedAt,
          emittedAtMs: 20 + sequence,
          hookEventName: 'Stop',
          state: 'idle',
          boundary: { kind: 'end', outcome: 'completed' },
        },
        { providerSessionId: 'B', conversationGeneration: generation, promptId },
      )
    stop(1, 'new', Date.now() - 1000)
    stop(999, 'old')
    expect(f.fence().lastTurnEnd).toBeNull()
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
    ).not.toBeNull()
  } finally {
    f.registry.dispose()
  }
})
