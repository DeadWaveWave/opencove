import { describe, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'

describe('agent binding filter invalidation', () => {
  it.each(['live', 'replay'] as const)(
    'invalidates old Space/project/node filters during %s delivery',
    mode => {
      const registry = new AgentRunStateRegistry({
        epoch: 'e',
        now: () => 1,
        createTurnId: () => 't',
        schedule: () => () => {},
      })
      registry.register({
        sessionId: 's',
        nodeId: 'n',
        provider: 'codex',
        incarnation: 'i',
        projectId: 'p',
        spaceId: 'a',
      })
      const watermark = registry.list({ spaceId: 'a' })
      const cursor = { epoch: watermark.epoch, afterSeq: watermark.seq }
      const oldSpace = vi.fn(),
        oldProject = vi.fn(),
        oldNode = vi.fn(),
        nextSpace = vi.fn(),
        all = vi.fn()
      const subscribe = () => {
        registry.subscribe(cursor, { spaceId: 'a', types: ['agent.turn_completed'] }, oldSpace)
        registry.subscribe(cursor, { projectId: 'p' }, oldProject)
        registry.subscribe(cursor, { nodeId: 'n' }, oldNode)
        registry.subscribe(cursor, { spaceId: 'b' }, nextSpace)
        registry.subscribe(cursor, {}, all)
      }
      if (mode === 'live') {
        subscribe()
      }
      registry.bind('s', { nodeId: null, projectId: 'q', spaceId: 'b' })
      if (mode === 'replay') {
        subscribe()
      }
      for (const listener of [oldSpace, oldProject, oldNode]) {
        expect(listener).toHaveBeenCalledExactlyOnceWith({
          type: 'resync_required',
          epoch: 'e',
          seq: 2,
          query: 'agent.list',
        })
      }
      expect(nextSpace).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: 'agent.state_changed',
          snapshot: expect.objectContaining({ nodeId: null }),
        }),
      )
      expect(all).toHaveBeenCalledTimes(1)
      expect(registry.list({ spaceId: 'a' }).agents).toEqual([])
      registry.dispose()
    },
  )
})

it('publishes displacement and re-binding while preserving session lookup and fencing delayed exit', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const events: { sessionId: string; nodeId: string | null }[] = []
  registry.register({ sessionId: 's', nodeId: 'n', incarnation: 's', provider: 'codex' })
  const cursor = registry.list()
  const oldNode = vi.fn()
  registry.subscribe(
    { epoch: cursor.epoch, afterSeq: cursor.seq },
    { nodeId: 'n', types: ['agent.turn_completed'] },
    oldNode,
  )
  registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event => {
    if (event.type !== 'resync_required') {
      events.push({ sessionId: event.snapshot.sessionId, nodeId: event.snapshot.nodeId })
    }
  })
  try {
    registry.register({ sessionId: 'r', nodeId: 'n', incarnation: 'r', provider: 'codex' })
    expect(registry.get({ sessionId: 's' })?.nodeId).toBeNull()
    expect(oldNode).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'resync_required', query: 'agent.list' }),
    )
    expect(registry.get({ nodeId: 'n' })?.sessionId).toBe('r')
    expect(events).toContainEqual({ sessionId: 's', nodeId: null })
    registry.bind('s', { nodeId: 'n' })
    expect(registry.get({ nodeId: 'n' })?.sessionId).toBe('s')
    expect(registry.get({ sessionId: 'r' })?.nodeId).toBeNull()
    expect(events).toContainEqual({ sessionId: 's', nodeId: 'n' })
    registry.observe('r', {
      incarnation: 'r',
      source: 'exit',
      sourceSequence: 1,
      observedAt: 2,
      state: 'exited',
    })
    expect(registry.get({ sessionId: 'r' })).toMatchObject({ nodeId: null, state: 'exited' })
    expect(registry.get({ nodeId: 'n' })?.sessionId).toBe('s')
    expect(registry.retire({ sessionId: 'r', incarnation: 'r' })).toBe(true)
    expect(registry.get({ nodeId: 'n' })?.sessionId).toBe('s')
  } finally {
    registry.dispose()
  }
})

it('captures loss before claim and preserves binding truth during reentrant fence callbacks', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  registry.register({ sessionId: 's', nodeId: 'n', incarnation: 's', provider: 'codex' })
  const cursor = registry.list()
  const events: { sessionId: string; nodeId: string | null }[] = []
  registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event => {
    if (event.type !== 'resync_required') {
      events.push(event.snapshot)
    }
  })
  let reentered = false
  registry.watchFence(registry.readFence({ nodeId: 'n' })!, receipt => {
    if (!reentered && receipt.fence?.snapshot.nodeId === null) {
      reentered = true
      for (const snapshot of registry.list().agents) {
        if (snapshot.nodeId !== null) {
          expect(registry.get({ nodeId: snapshot.nodeId })?.sessionId).toBe(snapshot.sessionId)
        }
      }
      registry.bind('s', { nodeId: 'n' })
    }
  })
  try {
    registry.register({ sessionId: 'r', nodeId: 'n', incarnation: 'r', provider: 'codex' })
    expect(events.map(({ sessionId, nodeId }) => ({ sessionId, nodeId }))).toEqual([
      { sessionId: 's', nodeId: null },
      { sessionId: 'r', nodeId: 'n' },
      { sessionId: 'r', nodeId: null },
      { sessionId: 's', nodeId: 'n' },
    ])
    expect(registry.get({ nodeId: 'n' })?.sessionId).toBe('s')
  } finally {
    registry.dispose()
  }
})
