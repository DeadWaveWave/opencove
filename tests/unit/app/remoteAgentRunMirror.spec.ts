import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { RemoteAgentRunMirror } from '../../../src/app/main/controlSurface/ptyStream/remoteAgentRunMirror'
import { subscribeAgentRuntimeSocket } from '../../../src/app/main/controlSurface/ptyStream/agentRuntimeSocket'

function worker(epoch: string, retention = 32) {
  let time = 100,
    turn = 0
  const schedule = vi.fn(() => () => {})
  const registry = new AgentRunStateRegistry({
    epoch,
    retention,
    now: () => time,
    createTurnId: () => `${epoch}-turn-${++turn}`,
    schedule,
  })
  const runtime = new AgentRunStateRuntime(registry, () => time)
  runtime.metadata({ sessionId: 'remote', agentProvider: 'codex', resumeSessionId: null })
  const observe = (name: string, state: 'working' | 'standby') =>
    runtime.observe({
      sessionId: 'remote',
      source: 'codex_hook',
      hookEventName: name,
      state,
      observedAtMs: ++time,
    })
  return { registry, runtime, observe, schedule }
}
function fixture(retention = 32) {
  const remote = worker('remote-epoch', retention)
  const home = worker('home-epoch')
  home.runtime.setBindings([
    { sessionId: 'home', nodeId: 'node', projectId: 'p', spaceId: 'space', remote: true },
  ])
  home.runtime.metadata({
    sessionId: 'home',
    agentProvider: 'codex',
    resumeSessionId: null,
    remote: true,
  })
  const reconnect = vi.fn()
  const mirror = new RemoteAgentRunMirror({
    sessions: () => ['remote'],
    reconnect,
    emit: (_id, event) => home.runtime.observe({ ...event, sessionId: 'home' }),
  })
  const frames: string[] = []
  let socket: ReturnType<typeof connect> | undefined
  function connect(registry = remote.registry, supported = true) {
    const hello = mirror.hello()
    mirror.handleMessage(
      JSON.stringify({ type: 'hello_ack', capabilities: supported ? { agentRunEvents: 1 } : {} }),
    )
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: (raw: string) => {
        frames.push(raw)
        mirror.handleMessage(raw)
      },
      terminate() {
        this.readyState = 3
        this.emit('close')
      },
    })
    if (supported) {
      subscribeAgentRuntimeSocket(registry, ws as unknown as WebSocket, hello.agentRunCursor)
    }
    socket = ws
    return ws
  }
  const disconnect = () => {
    socket?.terminate()
    mirror.disconnect()
  }
  return {
    remote,
    home,
    mirror,
    frames,
    connect,
    disconnect,
    reconnect,
    get: () => home.registry.get({ nodeId: 'node' })!,
    dispose: () => {
      disconnect()
      home.runtime.dispose()
      remote.runtime.dispose()
    },
  }
}

describe('two Worker decided-state mirroring', () => {
  it('preserves inferred and degraded quality and leaves turn endings to the executing Worker', () => {
    const f = fixture()
    try {
      f.connect()
      f.remote.registry.observe('remote', {
        incarnation: 'remote',
        sourceSequence: 1,
        source: 'session_file',
        state: 'working',
        observedAt: 101,
        boundary: { kind: 'start', evidence: 'busy', inferred: true },
      })
      expect(f.get()).toMatchObject({
        quality: 'inferred',
        turn: { id: 'remote-epoch-turn-1', start: 'inferred' },
      })
      f.remote.registry.observe('remote', {
        incarnation: 'remote',
        sourceSequence: 2,
        source: 'session_file',
        state: 'unknown',
        observedAt: 102,
        degraded: true,
      })
      expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded' })
      const watermark = f.home.registry.list(),
        completed = vi.fn()
      f.home.registry.subscribe(
        { epoch: watermark.epoch, afterSeq: watermark.seq },
        { types: ['agent.turn_completed'] },
        completed,
      )
      f.home.runtime.exit('home')
      expect(completed).not.toHaveBeenCalled()
      f.remote.runtime.exit('remote')
      expect(completed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({ state: 'exited', turnOutcome: 'unknown' }),
          endedTurn: expect.objectContaining({ id: 'remote-epoch-turn-1' }),
        }),
      )
      f.mirror.forget('remote')
      expect(f.mirror['snapshots'].has('remote')).toBe(false)
    } finally {
      f.dispose()
    }
  })
  it('negotiates support, maps bindings and preserves turn identity/quality without local arbitration', () => {
    const f = fixture()
    try {
      f.remote.observe('UserPromptSubmit', 'working')
      f.connect()
      expect(f.get()).toMatchObject({
        sessionId: 'home',
        nodeId: 'node',
        state: 'working',
        quality: 'authoritative',
        turn: { id: 'remote-epoch-turn-1' },
      })
      f.home.runtime.observe({
        sessionId: 'home',
        remote: true,
        state: 'standby',
        source: 'session_file',
      })
      expect(f.get().state).toBe('working')
      const baseline = f.home.registry.list()
      const events = vi.fn()
      f.home.registry.subscribe(
        { epoch: baseline.epoch, afterSeq: baseline.seq },
        { types: ['agent.turn_completed'] },
        events,
      )
      f.remote.observe('StopFailure', 'standby')
      expect(events).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          epoch: 'home-epoch',
          snapshot: expect.objectContaining({ sessionId: 'home', turnOutcome: 'failed' }),
          endedTurn: { id: 'remote-epoch-turn-1', startedAt: 101, start: 'observed' },
        }),
      )
      const seq = f.home.registry.list().seq
      const last = f.frames.filter(frame => JSON.parse(frame).type === 'agent.event').at(-1)!
      f.mirror.handleMessage(last)
      expect(f.home.registry.list().seq).toBe(seq)
      expect(f.home.schedule).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  })
  it('keeps unsupported peers unknown and replays completions exactly once across disconnect/reconnect', () => {
    const f = fixture()
    try {
      f.connect(f.remote.registry, false)
      f.home.runtime.observe({
        sessionId: 'home',
        remote: true,
        state: 'standby',
        source: 'codex_hook',
        hookEventName: 'Stop',
      })
      expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded' })
      f.disconnect()
      f.connect()
      f.remote.observe('UserPromptSubmit', 'working')
      f.disconnect()
      expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded' })
      const watermark = f.home.registry.list(),
        completed = vi.fn()
      f.home.registry.subscribe(
        { epoch: watermark.epoch, afterSeq: watermark.seq },
        { types: ['agent.turn_completed'] },
        completed,
      )
      f.remote.observe('Stop', 'standby')
      f.connect()
      expect(f.get()).toMatchObject({
        state: 'idle',
        turnOutcome: 'completed',
        quality: 'authoritative',
      })
      expect(completed).toHaveBeenCalledTimes(1)
      f.disconnect()
      f.connect()
      expect(completed).toHaveBeenCalledTimes(1)
      expect(f.get().state).toBe('idle')
    } finally {
      f.dispose()
    }
  })
  it('resynchronizes retention gaps and changed epochs without inventing historical completions', () => {
    const f = fixture(2),
      replacement = worker('next-epoch')
    try {
      f.connect()
      f.disconnect()
      f.remote.observe('UserPromptSubmit', 'working')
      f.remote.observe('Stop', 'standby')
      const baseline = f.home.registry.list(),
        completed = vi.fn()
      f.home.registry.subscribe(
        { epoch: baseline.epoch, afterSeq: baseline.seq },
        { types: ['agent.turn_completed'] },
        completed,
      )
      f.connect()
      expect(f.frames.some(frame => JSON.parse(frame).type === 'agent.resync_required')).toBe(true)
      expect(f.get().state).toBe('idle')
      expect(completed).not.toHaveBeenCalled()
      f.disconnect()
      replacement.observe('UserPromptSubmit', 'working')
      f.connect(replacement.registry)
      expect(f.get().turn?.id).toBe('next-epoch-turn-1')
      const stale = f.frames.find(frame => JSON.parse(frame).type === 'agent.baseline')!
      f.mirror.handleMessage(stale)
      expect(f.get()).toMatchObject({ state: 'unknown', quality: 'degraded' })
      expect(f.reconnect).toHaveBeenCalledTimes(1)
    } finally {
      replacement.runtime.dispose()
      f.dispose()
    }
  })
  it('invalidates an out-of-sequence remote stream and releases subscriptions on disconnect', () => {
    const f = fixture()
    try {
      f.connect()
      f.remote.observe('UserPromptSubmit', 'working')
      const frame = JSON.parse(
        f.frames.filter(value => JSON.parse(value).type === 'agent.event').at(-1)!,
      )
      frame.event.seq += 2
      f.mirror.handleMessage(JSON.stringify(frame))
      expect(f.get().state).toBe('unknown')
      expect(f.reconnect).toHaveBeenCalledTimes(1)
      f.disconnect()
      const count = f.frames.length
      f.remote.observe('Stop', 'standby')
      expect(f.frames).toHaveLength(count)
    } finally {
      f.dispose()
    }
  })
})
