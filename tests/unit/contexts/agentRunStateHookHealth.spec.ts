import { describe, expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { AGENT_HOOK_FRESHNESS_MS } from '../../../src/contexts/agent/domain/agentRunStateArbiter'

// Ported from the removed renderer arbiter owner specs (agentHookStartupHealth and
// piAgentFallback): the same behaviours, asserted against the Worker's AgentRunStateRuntime that
// production uses.
function createRuntime() {
  let now = 0
  const timers: Array<{ at: number; callback: () => void; active: boolean }> = []
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => now,
    createTurnId: () => 'turn',
    schedule: (callback, delayMs) => {
      const timer = { at: now + delayMs, callback, active: true }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
  })
  const runtime = new AgentRunStateRuntime(registry, () => now)
  return {
    registry,
    runtime,
    timers,
    advanceTo(ms: number) {
      now = ms
      for (const timer of timers) {
        if (timer.active && timer.at <= now) {
          timer.active = false
          timer.callback()
        }
      }
    },
    snapshot: (sessionId: string) => registry.get({ sessionId }),
  }
}

describe('Worker hook startup health', () => {
  it('does not report failure before the first hook observation, but does once a working hook goes stale', () => {
    const f = createRuntime()
    f.runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'codex' })
    f.runtime.observe({
      sessionId: 's',
      source: 'session_file',
      state: 'standby',
      hookInstallState: 'installed',
    })
    expect(f.snapshot('s')).toMatchObject({
      state: 'idle',
      source: 'session_file',
      quality: 'inferred',
    })

    // Startup silence is not a working lease: no deadline is armed without a hook signal.
    f.advanceTo(AGENT_HOOK_FRESHNESS_MS * 2)
    expect(f.timers.filter(timer => timer.active)).toEqual([])
    expect(f.snapshot('s')).toMatchObject({ state: 'idle', quality: 'inferred' })

    f.runtime.observe({
      sessionId: 's',
      source: 'codex_hook',
      state: 'working',
      hookEventName: 'task_started',
      hookInstallState: 'installed',
    })
    expect(f.snapshot('s')).toMatchObject({
      state: 'working',
      source: 'codex_hook',
      quality: 'authoritative',
    })

    // A previously observed working hook can really go stale, and must stop claiming authority.
    f.advanceTo(AGENT_HOOK_FRESHNESS_MS * 3)
    expect(f.snapshot('s')).toMatchObject({ state: 'unknown', quality: 'degraded' })
    f.runtime.dispose()
  })
})

describe('Worker hook authority and timers', () => {
  const hook = (state: 'working' | 'waiting') => ({
    sessionId: 's',
    source: 'claude_hook' as const,
    state,
    hookEventName: state === 'working' ? 'UserPromptSubmit' : undefined,
    hookInstallState: 'installed' as const,
  })

  it('keeps a fresh hook authoritative over a later session-file signal', () => {
    const f = createRuntime()
    f.runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'claude-code' })
    f.runtime.observe(hook('waiting'))
    f.runtime.observe({
      sessionId: 's',
      source: 'session_file',
      state: 'standby',
      hookInstallState: 'installed',
    })
    expect(f.snapshot('s')).toMatchObject({ state: 'waiting', source: 'claude_hook' })
    expect(f.timers.filter(timer => timer.active)).toEqual([])
    f.runtime.dispose()
  })

  it('re-arms one expiry per fresh hook signal and cancels it on exit, forget and dispose', () => {
    const f = createRuntime()
    f.runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'claude-code' })
    f.runtime.metadata({ sessionId: 't', resumeSessionId: null, agentProvider: 'claude-code' })
    f.runtime.observe({ ...hook('working'), sessionId: 's' })
    f.advanceTo(1_000)
    f.runtime.observe({ ...hook('working'), sessionId: 's' })
    expect(f.timers.filter(timer => timer.active)).toHaveLength(1)
    expect(f.timers.filter(timer => timer.active)[0]?.at).toBe(1_000 + AGENT_HOOK_FRESHNESS_MS)

    f.runtime.observe({ ...hook('working'), sessionId: 't' })
    expect(f.timers.filter(timer => timer.active)).toHaveLength(2)
    f.runtime.exit('s')
    expect(f.timers.filter(timer => timer.active)).toHaveLength(1)
    f.runtime.forget('t')
    expect(f.timers.filter(timer => timer.active)).toHaveLength(0)

    f.runtime.metadata({ sessionId: 'u', resumeSessionId: null, agentProvider: 'claude-code' })
    f.runtime.observe({ ...hook('working'), sessionId: 'u' })
    expect(f.timers.filter(timer => timer.active)).toHaveLength(1)
    f.runtime.dispose()
    expect(f.timers.filter(timer => timer.active)).toHaveLength(0)
  })

  it('uses a degraded launch fallback only until the session file becomes observable', () => {
    const f = createRuntime()
    f.runtime.metadata({ sessionId: 'kimi', resumeSessionId: null, agentProvider: 'kimi' })
    f.runtime.observe({ sessionId: 'kimi', source: 'launch', state: 'standby', degraded: true })
    expect(f.snapshot('kimi')).toMatchObject({ state: 'unknown', quality: 'degraded' })
    f.runtime.observe({ sessionId: 'kimi', source: 'session_file', state: 'working' })
    expect(f.snapshot('kimi')).toMatchObject({
      state: 'working',
      source: 'session_file',
      quality: expect.not.stringMatching('degraded'),
    })
    f.runtime.dispose()
  })
})

describe('Worker Pi conversation fallback', () => {
  const pi = (revision: number) => ({ piConversation: { pid: 12, revision } })

  it('drops cached file evidence on a native conversation change and never invents state', () => {
    const f = createRuntime()
    f.runtime.observe({ sessionId: 'pty', source: 'pi_hook', state: 'working', ...pi(1) })
    f.runtime.observe({ sessionId: 'pty', source: 'session_file', state: 'standby', ...pi(1) })
    f.runtime.observe({ sessionId: 'pty', source: 'pi_hook', state: 'working', ...pi(2) })
    expect(f.snapshot('pty')).toMatchObject({ state: 'working', source: 'pi_hook' })

    // Evidence from the previous conversation, or with no conversation, is ignored.
    f.runtime.observe({ sessionId: 'pty', source: 'session_file', state: 'standby', ...pi(1) })
    f.runtime.observe({ sessionId: 'pty', source: 'session_file', state: 'standby' })
    expect(f.snapshot('pty')).toMatchObject({ state: 'working', source: 'pi_hook' })
    f.runtime.dispose()
  })

  it('keeps unavailable file evidence unknown instead of completing the turn', () => {
    const f = createRuntime()
    f.runtime.observe({ sessionId: 'pty', source: 'pi_hook', state: 'working', ...pi(2) })
    f.runtime.observe({
      sessionId: 'pty',
      source: 'session_file',
      state: 'standby',
      observationUnavailable: true,
      ...pi(2),
    })
    expect(f.snapshot('pty')?.state).not.toBe('idle')
    f.runtime.dispose()
  })
})
