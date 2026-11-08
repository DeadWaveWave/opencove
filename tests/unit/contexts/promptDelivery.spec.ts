import { BracketedPasteIngressTracker } from '../../../src/app/main/controlSurface/ptyStream/BracketedPasteIngressTracker'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import type { ReservedSessionInput } from '../../../src/contexts/agent/application/ports/PromptDeliveryPorts'
import type { AgentRunObservation } from '../../../src/contexts/agent/domain/agentRunState'

function fixture(provider: 'claude-code' | 'codex' = 'claude-code', ready = true) {
  const schedule = (cb: () => void, delay: number) => {
    const timer = setTimeout(cb, delay)
    return () => clearTimeout(timer)
  }
  const runs = new AgentRunStateRegistry({
    epoch: 'e',
    now: Date.now,
    createTurnId: () => 'turn',
    schedule,
  })
  runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider })
  runs.setRuntimeContext('s', {
    remote: false,
    launchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  let seq = 0
  const observe = (
    state: AgentRunObservation['state'],
    hookEventName = 'Stop',
    extra: Partial<AgentRunObservation> = {},
  ) =>
    runs.observe('s', {
      incarnation: 'i',
      source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
      sourceSequence: ++seq,
      observedAt: Date.now(),
      emittedAtMs: Date.now(),
      state,
      hookEventName,
      boundary:
        hookEventName === 'UserPromptSubmit'
          ? { kind: 'start', evidence: 'prompt_submit' }
          : hookEventName === 'Stop'
            ? { kind: 'end', outcome: 'completed' }
            : undefined,
      ...extra,
    })
  if (ready) {
    observe('idle')
  }
  const writes: string[] = []
  const invalidations = new Set<() => void>()
  let mode = true,
    live = true
  const input: ReservedSessionInput = {
    generation: {},
    isLive: () => live,
    mode: () => ({ bracketedPaste: mode, watermark: 5 }),
    write: data => {
      writes.push(data)
    },
    watchInvalidation: cb => {
      invalidations.add(cb)
      return () => {
        invalidations.delete(cb)
      }
    },
  }
  let queued: (() => Promise<unknown>) | undefined
  let queue = false
  const service = new PromptDeliveryService({
    runs,
    input: {
      withSessionInputOperation: async (_id, fn) => {
        if (queue) {
          return await new Promise(resolve => {
            queued = async () => resolve(await fn(input))
          })
        }
        return await fn(input)
      },
    },
    capability: requestedProvider =>
      ['claude-code', 'codex'].includes(requestedProvider)
        ? { supported: true, submitDelayMs: 300 }
        : undefined,
    now: Date.now,
    createDeliveryId: () => 'delivery',
    schedule,
  })
  const deliver = (timeoutMs = 15000, caller = {}) =>
    service.deliver({ nodeId: 'n', text: 'one\ntwo\nthree\n', timeoutMs }, caller)
  return {
    runs,
    service,
    observe,
    writes,
    input,
    deliver,
    queue: () => {
      queue = true
    },
    release: () => queued!(),
    loseMode: () => {
      mode = false
      for (const cb of invalidations) {
        cb()
      }
      mode = true
    },
    loseLive: () => {
      live = false
    },
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe.each(['claude-code', 'codex'] as const)('PromptDeliveryService %s', provider => {
  it.each([
    ['waiting', 'PermissionRequest', 'agent.blocked', 'waiting'],
    ['working', 'UserPromptSubmit', 'agent.busy', 'working'],
    ['unknown', 'Stop', 'agent.state_unknown', 'observation_degraded'],
    ['exited', 'Stop', 'agent.not_running', 'not_running'],
    ['idle', 'notify', 'agent.state_unknown', 'readiness_unobserved'],
  ] as const)('refuses %s from %s with zero bytes', async (state, name, code, reason) => {
    const f = fixture(provider, name !== 'notify')
    f.observe(state, name, state === 'exited' ? { source: 'exit' } : {})
    await expect(f.deliver()).rejects.toMatchObject({
      code,
      details: { reason, pasteDispatchAttempted: false, submitDispatchAttempted: false },
    })
    expect(f.writes).toEqual([])
  })
  it.each(['remote', 'provider', 'degraded', 'fresh', 'active-turn'] as const)(
    'refuses %s admission',
    async condition => {
      const f = fixture(provider)
      if (condition === 'remote') {
        f.runs.setRuntimeContext('s', { remote: true })
      }
      if (condition === 'provider') {
        f.runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'other', provider: 'codex' })
      }
      if (condition === 'degraded') {
        f.runs.setRuntimeContext('s', { remote: false, hookInstallState: 'partial' })
      }
      if (condition === 'fresh') {
        f.runs.register({
          sessionId: 's',
          nodeId: 'n',
          incarnation: 'fresh',
          provider: 'claude-code',
        })
      }
      if (condition === 'active-turn') {
        f.observe('working', 'UserPromptSubmit')
        f.observe('idle', 'notify')
      }
      await expect(f.deliver()).rejects.toHaveProperty('code')
      expect(f.writes).toEqual([])
    },
  )
  it('writes one multiline paste and one Enter; waits for the exact accepted hook receipt', async () => {
    const f = fixture(provider)
    const result = f.deliver()
    expect(f.writes).toEqual(['\x1b[200~one\rtwo\rthree\x1b[201~'])
    await vi.advanceTimersByTimeAsync(300)
    expect(f.writes).toHaveLength(2)
    expect(f.writes[1]).toBe('\r')
    f.observe('working', 'task_started', {
      source: 'session_file',
      boundary: { kind: 'start', evidence: 'task_started', inferred: true },
    })
    let done = false
    void result.then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    f.loseMode() // Busy providers may disable paste after Enter; this is outside the latch.
    f.observe('working', 'UserPromptSubmit')
    await expect(result).resolves.toMatchObject({ phase: 'submission_observed', turnId: 'turn' })
    f.service.dispose()
    f.runs.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    'waiting-idle',
    'unchanged',
    'mode',
    'revocation',
    'replacement',
    'displaced',
    'rebind',
    'shutdown',
  ] as const)('latches %s during submit delay', async condition => {
    const f = fixture(provider)
    const controller = new AbortController()
    const result = f.deliver(15000, { signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({
      code: 'agent.prompt_interrupted',
      details: { pasteDispatchAttempted: true, submitDispatchAttempted: false },
    })
    if (condition === 'waiting-idle') {
      f.observe('waiting', 'PermissionRequest')
      f.observe('idle')
    }
    if (condition === 'unchanged') {
      f.observe('idle')
    }
    if (condition === 'mode') {
      f.loseMode()
    }
    if (condition === 'revocation') {
      controller.abort()
    }
    if (condition === 'replacement') {
      f.runs.register({ sessionId: 's', nodeId: 'n', incarnation: 'new', provider: 'claude-code' })
    }
    if (condition === 'displaced') {
      f.runs.register({ sessionId: 'other', nodeId: 'n', incarnation: 'other', provider })
      expect(f.runs.get({ sessionId: 's' })?.nodeId).toBeNull()
      expect(f.runs.get({ nodeId: 'n' })?.sessionId).toBe('other')
    }
    if (condition === 'rebind') {
      f.runs.bind('s', { nodeId: 'other' })
    }
    if (condition === 'shutdown') {
      f.service.dispose()
    }
    await vi.advanceTimersByTimeAsync(300)
    await assertion
    expect(f.writes).toHaveLength(1)
  })
  it('deadline settles a queued call and its eventual callback is a no-op', async () => {
    const f = fixture(provider)
    f.queue()
    const result = f.deliver(100)
    const assertion = expect(result).rejects.toMatchObject({
      code: 'agent.prompt_timeout',
      details: { pasteDispatchAttempted: false },
    })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    await f.release()
    expect(f.writes).toEqual([])
  })
  it('reserves the incarnation through receipt settlement and never resends', async () => {
    const f = fixture(provider)
    const result = f.deliver()
    await expect(f.deliver()).rejects.toMatchObject({
      code: 'agent.busy',
      details: { reason: 'delivery_in_progress' },
    })
    const assertion = expect(result).rejects.toMatchObject({
      code: 'agent.prompt_stalled',
      details: { pasteDispatchAttempted: true, submitDispatchAttempted: true },
    })
    await vi.advanceTimersByTimeAsync(5300)
    await assertion
    expect(f.writes).toHaveLength(2)
    f.observe('working', 'UserPromptSubmit')
    f.service.dispose()
    expect(f.writes).toHaveLength(2)
  })
  it('rejects a late old hook below the submit fence', async () => {
    const f = fixture(provider)
    const result = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    f.observe('working', 'UserPromptSubmit', { sourceSequence: 1 })
    const assertion = expect(result).rejects.toHaveProperty('code', 'agent.prompt_stalled')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })
  it('a synchronous invalidation from paste dispatch cannot leak a timer or send Enter', async () => {
    const f = fixture(provider)
    f.input.write = data => {
      f.writes.push(data)
      f.observe('waiting', 'PermissionRequest')
    }
    await expect(f.deliver()).rejects.toMatchObject({ code: 'agent.prompt_interrupted' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.writes).toHaveLength(1)
    f.service.dispose()
    f.runs.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('queued admission reports the current permission reason and sends zero bytes', async () => {
    const f = fixture(provider)
    f.queue()
    const result = f.deliver()
    f.observe('waiting', 'PermissionRequest', { blockedReason: 'permission' })
    await f.release()
    await expect(result).rejects.toMatchObject({
      code: 'agent.blocked',
      details: { blockedReason: 'permission', pasteDispatchAttempted: false },
    })
    expect(f.writes).toEqual([])
    f.service.dispose()
    f.runs.dispose()
  })
  it('does not count an inferred turn or a hook-labelled snapshot without a fresh submit receipt', async () => {
    const f = fixture(provider)
    const result = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    const snapshot = f.runs.get({ sessionId: 's' })!
    f.runs.mirror('s', {
      ...snapshot,
      state: 'working',
      quality: 'inferred',
      source: 'session_file',
      turn: { id: 'inferred', start: 'inferred', startedAt: Date.now() },
    })
    f.runs.mirror('s', {
      ...f.runs.get({ sessionId: 's' })!,
      source: 'claude_hook',
      quality: 'authoritative',
    })
    let observed = false
    void result.then(() => {
      observed = true
    })
    await Promise.resolve()
    expect(observed).toBe(false)
    f.observe('working', 'UserPromptSubmit')
    await expect(result).resolves.toMatchObject({
      phase: 'submission_observed',
      turnId: 'inferred',
    })
    f.runs.dispose()
    f.service.dispose()
  })

  it.each(['before paste', 'during delay'])(
    'real ingress reset %s forbids subsequent writes',
    async phase => {
      const f = fixture(provider),
        tracker = new BracketedPasteIngressTracker()
      tracker.feed('\x1b[?2004h')
      f.input.mode = () => ({
        bracketedPaste: tracker.bracketedPaste,
        watermark: tracker.watermark,
      })
      f.input.watchInvalidation = listener => tracker.watchInvalidation(listener)
      if (phase === 'before paste') {
        tracker.feed('\x1b[0!p')
      }
      const result = f.deliver()
      const assertion = expect(result).rejects.toMatchObject({
        code: phase === 'before paste' ? 'agent.prompt_unsupported' : 'agent.prompt_interrupted',
      })
      if (phase === 'during delay') {
        tracker.feed('\x1b[0!p')
      }
      await vi.advanceTimersByTimeAsync(300)
      await assertion
      expect(f.writes).toHaveLength(phase === 'before paste' ? 0 : 1)
      f.service.dispose()
      f.runs.dispose()
    },
  )
})
