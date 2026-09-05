import { describe, expect, it, vi } from 'vitest'
import { createAgentRunStateArbiterOwner } from '../../../src/app/renderer/shell/utils/agentRunStateArbiterOwner'
import { AGENT_HOOK_FRESHNESS_MS } from '../../../src/contexts/agent/domain/agentRunStateArbiter'

describe('Agent Hook startup health', () => {
  it.each(['menu', 'terminal'] as const)(
    '%s does not report failure before its first Hook observation',
    entry => {
      let now = 0
      const onDecision = vi.fn()
      const setTimer = vi.fn(() => 1)
      const owner = createAgentRunStateArbiterOwner({
        now: () => now,
        onDecision,
        setTimer,
        clearTimer: vi.fn(),
      })
      try {
        if (entry === 'menu') {
          owner.observe({
            sessionId: entry,
            source: 'launch',
            state: 'working',
            hookInstallState: 'installed',
          })
        }
        owner.observe({
          sessionId: entry,
          source: 'session_file',
          state: 'standby',
          ...(entry === 'menu' ? { hookInstallState: 'installed' as const } : {}),
        })
        expect(onDecision).toHaveBeenLastCalledWith(
          expect.objectContaining({ source: 'session_file', state: 'standby', degraded: false }),
        )
        if (entry === 'menu') {
          expect(owner.getDebugState(entry)?.decision?.hookHealth).toBe('pending')
        }

        // Startup silence is not a working lease: old Codex notify may wait for an entire turn.
        now = AGENT_HOOK_FRESHNESS_MS * 2
        owner.refresh()
        expect(setTimer).not.toHaveBeenCalled()
        expect(onDecision.mock.calls.every(([event]) => event.degraded === false)).toBe(true)

        owner.observe({
          sessionId: entry,
          source: 'codex_hook',
          state: 'working',
          hookInstallState: 'installed',
        })
        expect(onDecision).toHaveBeenLastCalledWith(
          expect.objectContaining({ source: 'codex_hook', state: 'working', degraded: false }),
        )
        expect(owner.getDebugState(entry)?.decision?.hookHealth).toBe('fresh')

        // A previously observed working Hook can really go stale, and still must warn.
        now += AGENT_HOOK_FRESHNESS_MS
        owner.refresh()
        expect(onDecision).toHaveBeenLastCalledWith(
          expect.objectContaining({ source: 'session_file', state: 'standby', degraded: true }),
        )
      } finally {
        owner.dispose()
      }
    },
  )

  it('keeps explicit installation failure visible and recovers on a real Hook', () => {
    const onDecision = vi.fn()
    const owner = createAgentRunStateArbiterOwner({ onDecision })
    try {
      owner.observe({
        sessionId: 'failed',
        source: 'session_file',
        state: 'standby',
        hookInstallState: 'error',
      })
      expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ degraded: true }))
      owner.observe({
        sessionId: 'failed',
        source: 'claude_hook',
        state: 'waiting',
        hookInstallState: 'installed',
      })
      expect(onDecision).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: 'claude_hook', degraded: false }),
      )
    } finally {
      owner.dispose()
    }
  })
})
