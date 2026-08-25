import { describe, expect, it } from 'vitest'
import {
  AGENT_HOOK_FRESHNESS_MS,
  resolveAgentRunStateAuthority,
} from '../../../src/contexts/agent/domain/agentRunStateArbiter'

const sessionFileStandby = { state: 'standby' as const, observedAtMs: 200 }

describe('agent run-state authority', () => {
  it('selects a fresh hook over a later conflicting session-file signal', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: 'installed',
        lastHookSignal: { state: 'waiting', observedAtMs: 100 },
        lastSessionFileSignal: sessionFileStandby,
        nowMs: 300,
      }),
    ).toEqual({
      source: 'claude_hook',
      state: 'waiting',
      degraded: false,
      hookHealth: 'fresh',
      nextTransitionAtMs: null,
    })
  })

  it('preserves the authoritative Codex hook source without changing hook policy', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: 'installed',
        lastHookSignal: { state: 'waiting', observedAtMs: 100, source: 'codex_hook' },
        lastSessionFileSignal: sessionFileStandby,
        nowMs: 300,
      }),
    ).toMatchObject({ source: 'codex_hook', state: 'waiting', degraded: false })
  })

  it('falls back at the exact freshness deadline when a working hook goes stale', () => {
    const deadline = 100 + AGENT_HOOK_FRESHNESS_MS
    const input = {
      hookInstallState: 'installed' as const,
      lastHookSignal: { state: 'working' as const, observedAtMs: 100 },
      lastSessionFileSignal: sessionFileStandby,
    }

    expect(resolveAgentRunStateAuthority({ ...input, nowMs: deadline - 1 })).toMatchObject({
      source: 'claude_hook',
      state: 'working',
      degraded: false,
      hookHealth: 'fresh',
      nextTransitionAtMs: deadline,
    })
    expect(resolveAgentRunStateAuthority({ ...input, nowMs: deadline })).toEqual({
      source: 'session_file',
      state: 'standby',
      degraded: true,
      hookHealth: 'stale',
      nextTransitionAtMs: null,
    })
  })

  it('keeps waiting authoritative beyond the freshness window because silence is expected', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: 'installed',
        lastHookSignal: { state: 'waiting', observedAtMs: 100 },
        lastSessionFileSignal: sessionFileStandby,
        nowMs: 100 + AGENT_HOOK_FRESHNESS_MS * 10,
      }),
    ).toEqual({
      source: 'claude_hook',
      state: 'waiting',
      degraded: false,
      hookHealth: 'fresh',
      nextTransitionAtMs: null,
    })
  })

  it('keeps standby authoritative until the next real hook signal', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: 'installed',
        lastHookSignal: { state: 'standby', observedAtMs: 100 },
        lastSessionFileSignal: { state: 'working', observedAtMs: 500 },
        nowMs: 100 + AGENT_HOOK_FRESHNESS_MS * 10,
      }),
    ).toMatchObject({
      source: 'claude_hook',
      state: 'standby',
      degraded: false,
      nextTransitionAtMs: null,
    })
  })

  it('uses session-file without degradation when the provider has no hook', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: null,
        lastHookSignal: null,
        lastSessionFileSignal: sessionFileStandby,
        nowMs: 300,
      }),
    ).toEqual({
      source: 'session_file',
      state: 'standby',
      degraded: false,
      hookHealth: 'not_applicable',
      nextTransitionAtMs: null,
    })
  })

  it.each(['partial', 'not_installed', 'error', 'skipped'] as const)(
    'surfaces %s hook fallback as degraded',
    hookInstallState => {
      expect(
        resolveAgentRunStateAuthority({
          hookInstallState,
          lastHookSignal: null,
          lastSessionFileSignal: sessionFileStandby,
          nowMs: 300,
        }),
      ).toMatchObject({
        source: 'session_file',
        state: 'standby',
        degraded: true,
        hookHealth: 'unavailable',
      })
    },
  )

  it('returns no winning source when neither observer has a signal', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: 'installed',
        lastHookSignal: null,
        lastSessionFileSignal: null,
        nowMs: 300,
      }),
    ).toEqual({
      source: null,
      state: null,
      degraded: true,
      hookHealth: 'stale',
      nextTransitionAtMs: null,
    })
  })

  it('projects a degraded launch fallback only when the session file is unavailable', () => {
    expect(
      resolveAgentRunStateAuthority({
        hookInstallState: null,
        lastHookSignal: null,
        lastSessionFileSignal: null,
        lastLaunchSignal: { state: 'standby', observedAtMs: 100, degraded: true },
        nowMs: 300,
      }),
    ).toEqual({
      source: 'launch',
      state: 'standby',
      degraded: true,
      hookHealth: 'unavailable',
      nextTransitionAtMs: null,
    })
  })
})
