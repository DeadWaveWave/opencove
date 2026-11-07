import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { inMemoryCodexHookChannel } from '../../support/inMemoryClaudeHookChannel'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

const capability = () => ({ supported: true as const, submitDelayMs: 300 })
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe.each(['codex', 'claude-code'] as const)(
  '%s readiness through runtime ingress',
  provider => {
    const source = provider === 'codex' ? 'codex_hook' : 'claude_hook'
    const refresh = provider === 'codex' ? 'notify' : 'Notification'
    const fixture = () => promptDeliveryRuntimeFixture(undefined, provider, false)
    it.each([false, true])(
      'retains Stop evidence after an idle refresh (start observed: %s)',
      started => {
        const f = fixture()
        try {
          if (started) {
            f.observe('UserPromptSubmit')
          }
          f.observe('Stop')
          const settled = f.registry.readFence({ sessionId: 's' })!
          f.observe(refresh)
          const refreshed = f.registry.readFence({ sessionId: 's' })!
          expect(refreshed.watermarks[source]).toBeGreaterThan(settled.watermarks[source]!)
          expect(refreshed.lastTurnEnd).toEqual(settled.lastTurnEnd)
          expect(refreshed.lastTurnEnd).toMatchObject({ source, hookEventName: 'Stop' })
          expect(promptAdmission(refreshed, capability)).toBeNull()
        } finally {
          f.dispose()
        }
      },
    )
    it('does not create readiness from an idle refresh alone', () => {
      const f = fixture()
      try {
        f.observe(refresh)
        const fence = f.registry.readFence({ sessionId: 's' })!
        expect(fence.snapshot).toMatchObject({ state: 'idle', source, turn: null })
        expect(fence.lastTurnEnd).toBeNull()
        expect(promptAdmission(fence, capability)).toEqual({
          code: 'agent.state_unknown',
          reason: 'readiness_unobserved',
        })
      } finally {
        f.dispose()
      }
    })
    it('invalidates readiness on a new turn even when a later refresh says idle', async () => {
      const f = fixture()
      try {
        f.observe('Stop')
        f.observe('UserPromptSubmit')
        f.observe(refresh)
        const fence = f.registry.readFence({ sessionId: 's' })!
        expect(fence.snapshot.state).toBe('idle')
        expect(fence.snapshot.turn).not.toBeNull()
        expect(fence.lastTurnEnd).toBeNull()
        await expect(f.deliver()).rejects.toMatchObject({
          code: 'agent.state_unknown',
          details: { reason: 'readiness_unobserved' },
        })
        expect(f.write).not.toHaveBeenCalled()
      } finally {
        f.dispose()
      }
    })
    it.each(['SessionEnd', 'SessionStart', 'shell', 'degraded'] as const)(
      'does not revive readiness after %s with an idle refresh',
      invalidation => {
        const f = fixture()
        try {
          f.observe('Stop')
          f.runtime.observe({
            sessionId: 's',
            source,
            state: 'standby',
            hookEventName:
              invalidation === 'shell'
                ? undefined
                : invalidation === 'degraded'
                  ? refresh
                  : invalidation,
            degraded: invalidation === 'degraded',
          })
          f.observe(refresh)
          expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
          expect(
            promptAdmission(f.registry.readFence({ sessionId: 's' }), capability),
          ).not.toBeNull()
        } finally {
          f.dispose()
        }
      },
    )
    it('ignores an unselected Stop and does not use it after a later idle refresh', () => {
      const f = fixture()
      try {
        f.observe('PermissionRequest')
        f.runtime.observe({
          sessionId: 's',
          source: 'session_file',
          state: 'standby',
          hookEventName: 'Stop',
        })
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
        f.observe(refresh)
        expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability)).not.toBeNull()
      } finally {
        f.dispose()
      }
    })
    it('does not reuse a stale Stop after a newer turn start', () => {
      const f = fixture()
      try {
        f.observe('Stop')
        vi.setSystemTime(1100)
        f.observe('UserPromptSubmit')
        f.runtime.observe({
          sessionId: 's',
          source,
          state: 'standby',
          hookEventName: 'Stop',
          observedAtMs: 1000,
        })
        f.observe(refresh)
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
        expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability)).not.toBeNull()
      } finally {
        f.dispose()
      }
    })
    it('exposes cloned evidence and clears it on incarnation replacement and mirroring', () => {
      const f = fixture()
      try {
        f.observe('Stop')
        const fence = f.registry.readFence({ sessionId: 's' })!
        fence.lastTurnEnd!.hookEventName = 'notify'
        expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability)).toBeNull()
        f.registry.mirror('s', f.registry.get({ sessionId: 's' })!)
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
        f.observe('Stop')
        f.registry.register({ sessionId: 's', nodeId: 'n', provider, incarnation: 'replacement' })
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
      } finally {
        f.dispose()
      }
    })
    it('uses the provider-specific lifecycle end policy', () => {
      const f = fixture()
      try {
        f.observe('StopFailure')
        f.observe(refresh)
        expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability) === null).toBe(
          provider === 'claude-code',
        )
      } finally {
        f.dispose()
      }
    })
    it('does not establish readiness with a degraded Stop', () => {
      const f = fixture()
      try {
        f.runtime.observe({
          sessionId: 's',
          source,
          state: 'standby',
          hookEventName: 'Stop',
          degraded: true,
        })
        f.observe(refresh)
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
        expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability)).not.toBeNull()
      } finally {
        f.dispose()
      }
    })
    it('accepts a launch Stop with no observed start without inventing completion, then observes the next prompt receipt', async () => {
      const f = fixture()
      const events: string[] = []
      const stop = f.registry.subscribe(
        { epoch: 'worker', afterSeq: f.registry.list().seq },
        {},
        event => {
          events.push(event.type)
        },
      )
      try {
        f.observe('Stop')
        f.observe(refresh)
        expect(events).not.toContain('agent.turn_completed')
        expect(f.registry.get({ sessionId: 's' })).toMatchObject({
          state: 'idle',
          turn: null,
          turnOutcome: null,
        })
        const result = f.deliver()
        await vi.advanceTimersByTimeAsync(300)
        expect(f.write.mock.calls.map(call => call[1])).toEqual(['\x1b[200~prompt\x1b[201~', '\r'])
        f.observe('UserPromptSubmit', Date.now())
        await expect(result).resolves.toMatchObject({
          phase: 'submission_observed',
          turnId: 'turn',
        })
        expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
      } finally {
        stop()
        f.dispose()
      }
    })
  },
)

it('Codex buffers launch Stop and notify before hook commit, then confirms the next real receiver submission', async () => {
  const socket = inMemoryCodexHookChannel()
  const f = promptDeliveryRuntimeFixture(undefined, 'codex', false)
  const unsubscribe = socket.channel.onState(event => f.runtime.observe(event))
  try {
    const reservation = await socket.channel.reserveSpawn()
    const token = reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!
    expect(await socket.post(token, 'Stop', '1000')).toBe(204)
    expect(await socket.post(token, 'notify', '1000')).toBe(204)
    expect(f.registry.readFence({ sessionId: 's' })!.lastTurnEnd).toBeNull()
    reservation.commit('s')
    expect(promptAdmission(f.registry.readFence({ sessionId: 's' }), capability)).toBeNull()
    const result = expect(f.deliver()).resolves.toMatchObject({ phase: 'submission_observed' })
    await vi.advanceTimersByTimeAsync(300)
    expect(await socket.post(token, 'UserPromptSubmit', String(Date.now()))).toBe(204)
    await result
    expect(f.write).toHaveBeenCalledTimes(2)
  } finally {
    unsubscribe()
    f.dispose()
    await socket.channel.dispose()
  }
})
