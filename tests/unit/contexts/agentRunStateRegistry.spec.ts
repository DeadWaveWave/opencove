import { describe, expect, it } from 'vitest'
import {
  AgentRunStateRegistry,
  type AgentRuntimeEvent,
} from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import {
  createAgentRunModel,
  transitionAgentRun,
  type AgentRunObservation,
} from '../../../src/contexts/agent/domain/agentRunState'

function fixture(retention = 32) {
  let now = 100
  let id = 0
  let sourceSequence = 0
  const timers = new Map<() => void, number>()
  const cancelled: (() => void)[] = []
  const schedule = (callback: () => void, delay: number) => {
    timers.set(callback, now + delay)
    return () => {
      timers.delete(callback)
      cancelled.push(callback)
    }
  }
  const advance = (ms: number) => {
    now += ms
    for (const [callback, deadline] of [...timers]) {
      if (deadline <= now && timers.delete(callback)) {
        callback()
      }
    }
  }
  const registry = new AgentRunStateRegistry({
    epoch: 'worker-1',
    now: () => now,
    createTurnId: () => `turn-${++id}`,
    retention,
    schedule,
  })
  registry.register({
    sessionId: 's',
    nodeId: 'n',
    provider: 'codex',
    incarnation: 'i',
    spaceId: 'space',
    projectId: 'project',
  })
  const observe = (input: Partial<AgentRunObservation> = {}) => {
    now += 10
    registry.observe('s', {
      incarnation: 'i',
      source: 'codex_hook',
      observedAt: now,
      sourceSequence: ++sourceSequence,
      state: 'working',
      ...input,
    })
  }
  return {
    registry,
    observe,
    advance,
    timers,
    cancelled,
    get: () => registry.get({ sessionId: 's' })!,
  }
}
const start = { kind: 'start', evidence: 'task_started' } as const
const end = { kind: 'end', outcome: 'completed' } as const

describe('AgentRunState domain', () => {
  it.each([
    { currentSource: 'codex_hook', staleSource: 'codex_hook', boundary: undefined },
    { currentSource: 'session_file', staleSource: 'codex_hook', boundary: start },
  ] as const)(
    'rejects stale $staleSource evidence before arbitration after $currentSource',
    ({ currentSource, staleSource, boundary }) => {
      const f = fixture()
      f.observe({ source: currentSource, observedAt: 300, boundary })
      const before = f.registry.list()
      f.observe({ source: staleSource, observedAt: 200, state: 'idle', boundary: end })
      expect(f.registry.list()).toEqual(before)
      expect(f.get().state).toBe('working')
      f.observe({ source: 'exit', observedAt: 50, state: 'exited' })
      expect(f.get().state).toBe('exited')
      f.registry.dispose()
    },
  )

  it('gives hook waiting priority over a newer file working observation', () => {
    const f = fixture()
    f.observe({ state: 'waiting', blockedReason: 'permission' })
    f.observe({ source: 'session_file', state: 'working', boundary: start })
    expect(f.get()).toMatchObject({ state: 'waiting', blockedReason: 'permission', turn: null })
  })
  it('does not open a turn on SessionStart/working refresh or complete an idle baseline', () => {
    const f = fixture()
    const events: AgentRuntimeEvent[] = []
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, e => {
      if (e.type !== 'resync_required') {
        events.push(e)
      }
    })
    f.observe()
    f.observe({ state: 'idle', boundary: end })
    expect(f.get().turn).toBeNull()
    expect(events.some(e => e.type === 'agent.turn_completed')).toBe(false)
  })
  it.each(['prompt_submit', 'task_started', 'agent_start', 'busy'] as const)(
    'opens on %s only once',
    evidence => {
      const f = fixture()
      f.observe({ boundary: { kind: 'start', evidence } })
      const turn = f.get().turn
      f.observe({ boundary: { kind: 'start', evidence } })
      expect(f.get().turn).toEqual(turn)
      expect(turn).toMatchObject({ id: 'turn-1', start: 'observed' })
    },
  )
  it.each(['completed', 'failed', 'aborted', 'unknown'] as const)(
    'preserves %s outcome',
    outcome => {
      const f = fixture()
      f.observe({ boundary: start })
      f.observe({ state: 'idle', boundary: { kind: 'end', outcome } })
      expect(f.get()).toMatchObject({ turn: null, turnOutcome: outcome })
    },
  )
  it('rejects duplicate, out-of-order, wrong-incarnation and post-exit observations', () => {
    const f = fixture()
    f.observe({ boundary: start, observedAt: 200 })
    const baseline = f.get()
    for (const observation of [
      { observedAt: 200, sourceSequence: 1 },
      { observedAt: 199, sourceSequence: 0 },
      { incarnation: 'old', observedAt: 201 },
    ]) {
      f.observe({ ...observation, state: 'idle', boundary: end })
    }
    expect(f.get()).toEqual(baseline)
    f.observe({ source: 'exit', state: 'exited' })
    expect(f.get()).toMatchObject({ state: 'exited', turn: null, turnOutcome: 'unknown' })
    f.observe({ boundary: start, observedAt: 1000 })
    expect(f.get().state).toBe('exited')
  })
  it('does not complete on a plain idle refresh', () => {
    const f = fixture()
    f.observe({ boundary: start })
    f.observe({ state: 'idle' })
    expect(f.get().turn).not.toBeNull()
    expect(f.get().turnOutcome).toBeNull()
  })
  it('keeps unavailable and degraded idle explicitly unknown', () => {
    const f = fixture()
    f.observe({ state: 'idle', degraded: true, boundary: end })
    expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded' })
    f.observe({ state: 'unknown' })
    expect(f.get().state).toBe('unknown')
  })
  it('fences historical starts behind an idle baseline', () => {
    const f = fixture()
    f.observe({ source: 'session_file', state: 'idle', observedAt: 500, boundary: end })
    f.observe({ source: 'codex_hook', state: 'working', observedAt: 400, boundary: start })
    expect(f.get().turn).toBeNull()
  })
  it('records inferred starts and never mutates its input model', () => {
    const model = createAgentRunModel({
      sessionId: 's',
      provider: 'codex',
      incarnation: 'i',
      now: 0,
    })
    const result = transitionAgentRun(
      model,
      {
        incarnation: 'i',
        source: 'session_file',
        observedAt: 1,
        sourceSequence: 1,
        state: 'working',
        boundary: { ...start, inferred: true },
      },
      2,
      () => 'turn',
    )
    expect(result.model.snapshot.turn).toEqual({ id: 'turn', startedAt: 1, start: 'inferred' })
    expect(model.snapshot.turn).toBeNull()
  })
})

describe('AgentRunStateRegistry', () => {
  it('returns atomic watermarks and replays filtered events without gaps', () => {
    const f = fixture()
    const baseline = f.registry.list()
    f.observe({ boundary: start })
    f.observe({ state: 'idle', boundary: end })
    const events: unknown[] = []
    const unsubscribe = f.registry.subscribe(
      { epoch: baseline.epoch, afterSeq: baseline.seq },
      { nodeId: 'n', spaceId: 'space', types: ['agent.turn_completed'] },
      e => events.push(e),
    )
    expect(events).toMatchObject([
      {
        type: 'agent.turn_completed',
        seq: 4,
        endedTurn: { id: 'turn-1' },
        snapshot: { turnOutcome: 'completed' },
      },
    ])
    unsubscribe()
    f.observe({ boundary: start })
    expect(events).toHaveLength(1)
  })
  it('requires re-query on retention overflow, epoch change and invalid cursor', () => {
    const f = fixture(1)
    f.observe({ boundary: start })
    for (const cursor of [
      { epoch: 'worker-1', afterSeq: 0 },
      { epoch: 'worker-0', afterSeq: 2 },
      { epoch: 'worker-1', afterSeq: 99 },
    ]) {
      const events: unknown[] = []
      f.registry.subscribe(cursor, {}, e => events.push(e))
      expect(events).toEqual([
        { type: 'resync_required', epoch: 'worker-1', seq: 2, query: 'agent.list' },
      ])
    }
  })
  it('fences replaced incarnations and has independent Worker sequence/epoch', () => {
    const f = fixture()
    f.observe({ boundary: start })
    f.registry.register({ sessionId: 's', provider: 'codex', incarnation: 'new' })
    f.observe({ state: 'idle', boundary: end })
    expect(f.get()).toMatchObject({ state: 'unknown', turn: null, turnOutcome: null })
    const next = new AgentRunStateRegistry({
      schedule: () => () => undefined,
      epoch: 'worker-2',
      now: () => 0,
      createTurnId: () => 'new',
    })
    expect(next.list()).toEqual({ epoch: 'worker-2', seq: 0, agents: [] })
  })
  it('isolates subscriber failures and snapshot mutations', () => {
    const f = fixture()
    const seen: number[] = []
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, () => {
      throw new Error('offline')
    })
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, e => {
      seen.push(e.seq)
      if (e.type !== 'resync_required') {
        e.snapshot.state = 'exited'
      }
    })
    f.observe({ boundary: start })
    expect(seen).toEqual([2])
    expect(f.get().state).toBe('working')
    f.registry.list().agents[0].state = 'exited'
    expect(f.get().state).toBe('working')
  })
  it('serializes reentrant live publications for every subscriber', () => {
    const f = fixture()
    const seen: number[] = []
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, e => {
      if (e.seq === 2) {
        f.observe({ state: 'waiting' })
      }
    })
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, e => seen.push(e.seq))
    f.observe({ boundary: start })
    expect(seen).toEqual([2, 3])
  })
  it('orders live publications triggered during replay after retained events', () => {
    const f = fixture()
    f.observe({ boundary: start })
    f.observe({ state: 'waiting' })
    const seen: number[] = []
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: 1 }, {}, e => {
      seen.push(e.seq)
      if (e.seq === 2) {
        f.observe({ state: 'working' })
      }
    })
    expect(seen).toEqual([2, 3, 4])
  })
})

describe('review regressions', () => {
  it('preserves distinct refresh/start/end events at the same timestamp and rejects redelivery', () => {
    const f = fixture()
    f.observe({ observedAt: 100, sourceSequence: 1 })
    f.observe({ observedAt: 100, sourceSequence: 2, boundary: start })
    expect(f.get().turn?.id).toBe('turn-1')
    f.observe({ observedAt: 100, sourceSequence: 3, state: 'idle', boundary: end })
    expect(f.get()).toMatchObject({ state: 'idle', turn: null, turnOutcome: 'completed' })
    const watermark = f.registry.list().seq
    f.observe({ observedAt: 100, sourceSequence: 3, state: 'idle', boundary: end })
    f.observe({ observedAt: 999, sourceSequence: 2, boundary: start })
    expect(f.registry.list().seq).toBe(watermark)
  })
})

describe('scheduled authority expiry', () => {
  it('publishes degraded expiry with no new observation and never completes the turn', () => {
    const f = fixture()
    f.observe({ boundary: start })
    const seq = f.registry.list().seq
    const events: unknown[] = []
    f.registry.subscribe({ epoch: 'worker-1', afterSeq: seq }, {}, e => events.push(e))
    f.advance(179999)
    expect(f.get().state).toBe('working')
    f.advance(1)
    expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded', turn: { id: 'turn-1' } })
    expect(f.registry.list().agents[0].state).toBe('unknown')
    expect(events).toMatchObject([{ type: 'agent.state_changed', seq: seq + 1 }])
    expect(f.timers.size).toBe(0)
  })
  it('does not replay old file completion when a hook lease expires', () => {
    const f = fixture()
    f.observe({ boundary: start })
    f.observe({ source: 'session_file', state: 'idle', boundary: end })
    const seq = f.registry.list().seq
    f.advance(180000)
    expect(f.get()).toMatchObject({
      state: 'unknown',
      quality: 'degraded',
      turn: { id: 'turn-1' },
      turnOutcome: null,
    })
    const events: unknown[] = []
    f.registry.subscribe(
      { epoch: 'worker-1', afterSeq: seq },
      { types: ['agent.turn_completed'] },
      e => events.push(e),
    )
    expect(events).toEqual([])
    f.observe({ state: 'idle', boundary: end })
    expect(f.get()).toMatchObject({ state: 'idle', turn: null, turnOutcome: 'completed' })
    expect(f.timers.size).toBe(0)
  })
  it('renews working deadlines, rejects cancelled callbacks and cancels waiting leases', () => {
    const f = fixture()
    f.observe({ boundary: start })
    const old = [...f.timers.keys()][0]
    f.advance(100000)
    f.observe()
    old()
    expect(f.timers.size).toBe(1)
    f.advance(80000)
    expect(f.get().state).toBe('working')
    f.observe({ state: 'waiting' })
    expect(f.timers.size).toBe(0)
    f.advance(200000)
    expect(f.get().state).toBe('waiting')
  })
  it('fences replaced sessions, exit and dispose against late timer callbacks', () => {
    const f = fixture()
    f.observe({ boundary: start })
    const old = [...f.timers.keys()][0]
    f.registry.register({ sessionId: 's', incarnation: 'replacement', provider: 'codex' })
    old()
    expect(f.get().state).toBe('unknown')
    expect(f.timers.size).toBe(0)
    f.observe({ incarnation: 'replacement', boundary: start })
    f.observe({ incarnation: 'replacement', source: 'exit', state: 'exited' })
    expect(f.timers.size).toBe(0)
    f.registry.register({ sessionId: 's', incarnation: 'third', provider: 'codex' })
    f.observe({ incarnation: 'third', boundary: start })
    const late = [...f.timers.keys()][0]
    f.registry.dispose()
    late()
    expect(f.timers.size).toBe(0)
    expect(f.registry.list().agents).toEqual([])
  })
})

describe('current node session binding', () => {
  it('selects a replacement while keeping historical session lookup explicit', () => {
    const f = fixture()
    f.observe({ source: 'exit', state: 'exited' })
    f.registry.register({ sessionId: 'new', nodeId: 'n', incarnation: 'new-i', provider: 'codex' })
    expect(f.registry.get({ nodeId: 'n' })).toMatchObject({ sessionId: 'new', state: 'unknown' })
    expect(f.registry.list().agents.map(agent => agent.sessionId)).toEqual(['new'])
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({ sessionId: 's', state: 'exited' })
    expect(f.registry.retire({ sessionId: 's', incarnation: 'i' })).toBe(true)
    expect(f.registry.get({ sessionId: 's' })).toBeNull()
    expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('new')
  })

  it('does not let late exit or retirement of the prior session erase the replacement', () => {
    const f = fixture()
    f.observe({ boundary: start })
    f.registry.register({ sessionId: 'new', nodeId: 'n', incarnation: 'new-i', provider: 'codex' })
    expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('new')
    f.observe({ source: 'exit', state: 'exited' })
    expect(f.registry.retire({ sessionId: 's', incarnation: 'i' })).toBe(true)
    expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('new')
    expect(f.registry.retire({ sessionId: 'new', incarnation: 'new-i' })).toBe(false)
    f.registry.observe('new', {
      source: 'exit',
      state: 'exited',
      incarnation: 'new-i',
      sourceSequence: 1,
      observedAt: 500,
    })
    expect(f.registry.retire({ sessionId: 'new', incarnation: 'new-i' })).toBe(true)
    expect(f.registry.get({ nodeId: 'n' })).toBeNull()
  })

  it('fences reused session IDs and clears only their own previous node binding', () => {
    const f = fixture()
    f.registry.register({
      sessionId: 'other',
      nodeId: 'n',
      incarnation: 'other-i',
      provider: 'codex',
    })
    f.registry.register({
      sessionId: 's',
      nodeId: 'new-node',
      incarnation: 'replacement',
      provider: 'codex',
    })
    expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('other')
    expect(f.registry.get({ nodeId: 'new-node' })?.sessionId).toBe('s')
    f.observe({ incarnation: 'replacement', source: 'exit', state: 'exited' })
    expect(f.registry.retire({ sessionId: 's', incarnation: 'i' })).toBe(false)
    expect(f.registry.get({ nodeId: 'new-node' })).not.toBeNull()
    expect(f.registry.retire({ sessionId: 's', incarnation: 'replacement' })).toBe(true)
    expect(f.registry.get({ nodeId: 'new-node' })).toBeNull()
    expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('other')
    f.registry.dispose()
    expect(f.registry.get({ nodeId: 'n' })).toBeNull()
  })

  it('removes an old node association when a session ID is reused on another node', () => {
    const f = fixture()
    f.registry.register({
      sessionId: 's',
      nodeId: 'new-node',
      incarnation: 'replacement',
      provider: 'codex',
    })
    expect(f.registry.get({ nodeId: 'n' })).toBeNull()
    expect(f.registry.get({ nodeId: 'new-node' })?.sessionId).toBe('s')
    f.registry.register({ sessionId: 's', incarnation: 'unbound', provider: 'codex' })
    expect(f.registry.get({ nodeId: 'new-node' })).toBeNull()
    expect(f.registry.get({ sessionId: 's' })?.nodeId).toBeNull()
  })
})
