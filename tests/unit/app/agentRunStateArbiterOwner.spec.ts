import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import { AGENT_HOOK_FRESHNESS_MS } from '../../../src/contexts/agent/domain/agentRunStateArbiter'
import { createAgentRunStateArbiterOwner } from '../../../src/app/renderer/shell/utils/agentRunStateArbiterOwner'

function createHarness() {
  let nowMs = 1_000
  let nextTimerId = 0
  const timers = new Map<number, { callback: () => void; delayMs: number }>()
  const decisions: TerminalSessionStateEvent[] = []
  const owner = createAgentRunStateArbiterOwner({
    now: () => nowMs,
    setTimer: (callback, delayMs) => {
      const id = ++nextTimerId
      timers.set(id, { callback, delayMs })
      return id
    },
    clearTimer: id => {
      timers.delete(id as number)
    },
    onDecision: event => decisions.push(event),
  })

  return {
    owner,
    decisions,
    timers,
    setNow: (value: number) => {
      nowMs = value
    },
    fireOnlyTimer: () => {
      expect(timers.size).toBe(1)
      const [id, timer] = [...timers.entries()][0]!
      timers.delete(id)
      timer.callback()
    },
  }
}

describe('agent run-state arbiter owner', () => {
  it('keeps session-file warm without projecting it while a hook wins', () => {
    const harness = createHarness()
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'standby',
      source: 'session_file',
      hookInstallState: 'installed',
    })

    expect(harness.decisions).toEqual([
      {
        sessionId: 'session-1',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
        degraded: false,
      },
    ])
    expect(harness.timers.size).toBe(0)
  })

  it('owns one replaceable timer and switches a stale working hook at its deadline', () => {
    const harness = createHarness()
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'standby',
      source: 'session_file',
      hookInstallState: 'installed',
    })
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    expect([...harness.timers.values()]).toEqual([
      { callback: expect.any(Function), delayMs: AGENT_HOOK_FRESHNESS_MS },
    ])

    harness.setNow(2_000)
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    expect(harness.timers.size).toBe(1)

    harness.setNow(2_000 + AGENT_HOOK_FRESHNESS_MS)
    harness.fireOnlyTimer()
    expect(harness.decisions.at(-1)).toEqual({
      sessionId: 'session-1',
      state: 'standby',
      source: 'session_file',
      hookInstallState: 'installed',
      degraded: true,
    })
    expect(harness.timers.size).toBe(0)
  })

  it('cancels timers on session removal, exit, and owner disposal', () => {
    const harness = createHarness()
    const observeWorking = (sessionId: string) =>
      harness.owner.observe({
        sessionId,
        state: 'working',
        source: 'claude_hook',
        hookInstallState: 'installed',
      })

    observeWorking('session-1')
    observeWorking('session-2')
    expect(harness.timers.size).toBe(2)

    harness.owner.syncSessions(new Set(['session-2']))
    expect(harness.timers.size).toBe(1)

    harness.owner.disposeSession('session-2')
    expect(harness.timers.size).toBe(0)

    observeWorking('session-3')
    const decisionCount = harness.decisions.length
    harness.owner.dispose()
    expect(harness.timers.size).toBe(0)
    harness.owner.observe({ sessionId: 'session-3', state: 'standby', source: 'session_file' })
    expect(harness.decisions).toHaveLength(decisionCount)
  })

  it('can refresh all sessions from an injected clock without sleeping', () => {
    const harness = createHarness()
    harness.owner.observe({ sessionId: 'session-1', state: 'standby', source: 'session_file' })
    harness.owner.observe({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })

    harness.setNow(1_000 + AGENT_HOOK_FRESHNESS_MS)
    harness.owner.refresh()

    expect(harness.decisions.at(-1)).toMatchObject({
      source: 'session_file',
      state: 'standby',
      degraded: true,
    })
  })

  it('does not leak a callback after clearing a replaced timer', () => {
    const clearTimer = vi.fn()
    const owner = createAgentRunStateArbiterOwner({
      now: () => 100,
      setTimer: vi.fn(() => 7),
      clearTimer,
      onDecision: vi.fn(),
    })
    owner.observe({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    owner.observe({
      sessionId: 'session-1',
      state: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    expect(clearTimer).toHaveBeenCalledWith(7)
  })

  it('uses a degraded launch fallback until Kimi wire becomes observable', () => {
    const harness = createHarness()
    harness.owner.observe({
      sessionId: 'kimi-session',
      state: 'standby',
      source: 'launch',
    })
    expect(harness.decisions).toEqual([])

    harness.owner.observe({
      sessionId: 'kimi-session',
      state: 'standby',
      source: 'launch',
      degraded: true,
    })
    harness.owner.observe({
      sessionId: 'kimi-session',
      state: 'working',
      source: 'session_file',
    })
    harness.owner.observe({
      sessionId: 'kimi-session',
      state: 'standby',
      source: 'launch',
      degraded: true,
    })

    expect(harness.decisions).toEqual([
      {
        sessionId: 'kimi-session',
        state: 'standby',
        source: 'launch',
        degraded: true,
      },
      {
        sessionId: 'kimi-session',
        state: 'working',
        source: 'session_file',
        degraded: false,
      },
      {
        sessionId: 'kimi-session',
        state: 'standby',
        source: 'launch',
        degraded: true,
      },
    ])
  })
})
