import { expect, it, vi } from 'vitest'
import { ClaudeLiveConversation } from '../../../src/contexts/agent/application/ClaudeLiveConversation'
import type { ClaudeConversationPorts } from '../../../src/contexts/agent/application/ClaudeConversationPorts'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

it('bounds retirement on orphan batches and releases every projection collection on disposal', () => {
  vi.useFakeTimers()
  try {
    const owner = new ClaudeLiveConversation((cb, ms) => {
      const timer = setTimeout(cb, ms)
      return () => clearTimeout(timer)
    })
    const ports: ClaudeConversationPorts = {
      reset() {},
      invalidate() {},
      ready() {},
      settled() {},
      canReady: () => true,
      completedTurnId: () => null,
    }
    const send = (id: string, name: string, at: number) => {
      owner.accept(
        {
          conversation: {
            event: {
              claudeSessionId: id,
              hookEventName: name,
              emittedAtMs: at,
              state: name === 'PermissionRequest' ? 'waiting' : null,
              sessionStartSource: name === 'SessionStart' ? 'clear' : undefined,
            },
            decide() {},
            publish() {},
          },
        } as ClaudeTranscriptObservation,
        Date.now(),
        ports,
      )
    }
    send('B', 'SessionStart', 20)
    vi.advanceTimersByTime(201)
    for (let batch = 0; batch < 10; batch++) {
      for (let i = 0; i < 31; i++) {
        send(`U${batch}-${i}`, 'PermissionRequest', 30 + batch * 100 + i)
      }
      send(`C${batch}`, 'SessionStart', 99 + batch * 100)
      vi.advanceTimersByTime(201)
      const projection = owner as unknown as { projectedRetired: Set<string> }
      expect(projection.projectedRetired.size).toBeLessThanOrEqual(256)
    }
    expect(owner.journal.saturated).toBe(true)
    owner.dispose()
    const projection = owner as unknown as {
      projectedRetired: Set<string>
      receipts: Set<string>
      pending: unknown[]
    }
    expect(projection.projectedRetired.size).toBe(0)
    expect(projection.receipts.size).toBe(0)
    expect(projection.pending).toHaveLength(0)
    expect(owner.journal.events).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
