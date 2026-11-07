// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { registryWaitFixture } from '../app/agentWaitRegistry.helpers'
import { endedSelectedTurn } from '../../../src/app/cli/core/agentWaitTurn'
import type {
  AgentRunEvent,
  AgentRunSnapshot,
} from '../../../src/shared/contracts/dto/agentRunState'

it.each([false, true])(
  'captures A before a fence callback starts B (finishes B=%s)',
  async finishB => {
    const f = registryWaitFixture()
    f.observe('working', 'start')
    const events: AgentRunEvent[] = []
    const cursor = f.registry.list()
    f.registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event => {
      if (event.type !== 'resync_required') {
        events.push(event)
      }
    })
    let reentered = false
    f.registry.watchFence(f.registry.readFence({ nodeId: 'n' })!, receipt => {
      if (!reentered && receipt.fence?.snapshot.lastEndedTurn?.id === 't1') {
        reentered = true
        f.observe('working', 'start')
        if (finishB) {
          f.observe('idle', 'failed')
        }
      }
    })
    const pending = f.wait('t1')
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
    f.observe('idle', 'completed')
    try {
      const a = events.find(event => event.endedTurn?.id === 't1')!
      expect(a.snapshot).toMatchObject({
        turn: null,
        turnOutcome: 'completed',
        lastEndedTurn: { id: 't1', outcome: 'completed' },
      })
      expect(
        events
          .filter(event => event.type === 'agent.turn_completed')
          .map(event => event.endedTurn!.id),
      ).toEqual(finishB ? ['t1', 't2'] : ['t1'])
      expect(await pending).toMatchObject({ turnId: 't1', outcome: 'completed' })
      expect(
        await endedSelectedTurn(
          a.snapshot,
          't1',
          payload => f.query('agent.finalMessage', payload),
          a,
        ),
      ).toMatchObject({ outcome: 'completed' })
    } finally {
      await pending.catch(() => {})
      f.registry.dispose()
    }
  },
)
it('does not use B outcome from an explicitly mismatched snapshot to classify A', async () => {
  const f = registryWaitFixture()
  f.observe('working', 'start')
  f.observe('idle', 'completed')
  f.observe('working', 'start')
  f.observe('idle', 'failed')
  const snapshot = f.registry.get({ nodeId: 'n' })!
  const event: AgentRunEvent = {
    type: 'agent.turn_completed',
    epoch: 'e',
    seq: 10,
    snapshot,
    endedTurn: { id: 't1', startedAt: 101, start: 'observed' },
  }
  try {
    expect(
      await endedSelectedTurn(
        snapshot,
        't1',
        payload => f.query('agent.finalMessage', payload),
        event,
      ),
    ).toMatchObject({ outcome: 'completed' })
  } finally {
    f.registry.dispose()
  }
})
it.each([false, true])('captures mirrored A before callback mirrors B (finishes B=%s)', finishB => {
  const f = registryWaitFixture()
  const base = f.registry.get({ nodeId: 'n' })!
  const a: AgentRunSnapshot = {
    ...base,
    state: 'idle',
    turnOutcome: 'completed',
    lastEndedTurn: { id: 'a', outcome: 'completed', endedAt: 2 },
  }
  const events: AgentRunEvent[] = []
  const cursor = f.registry.list()
  f.registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event => {
    if (event.type !== 'resync_required') {
      events.push(event)
    }
  })
  let reentered = false
  f.registry.watchFence(f.registry.readFence({ nodeId: 'n' })!, () => {
    if (reentered) {
      return
    }
    reentered = true
    const b = { id: 'b', startedAt: 3, start: 'observed' as const }
    f.registry.mirror('s', { ...a, state: 'working', turn: b, turnOutcome: null })
    if (finishB) {
      f.registry.mirror(
        's',
        { ...a, turnOutcome: 'failed', lastEndedTurn: { id: 'b', outcome: 'failed', endedAt: 4 } },
        b,
      )
    }
  })
  f.registry.mirror('s', a, { id: 'a', startedAt: 1, start: 'observed' })
  try {
    expect(events.find(event => event.endedTurn?.id === 'a')!.snapshot).toEqual(a)
  } finally {
    f.registry.dispose()
  }
})

it.each(['binding', 'registration'] as const)(
  'captures %s state before its fence callback opens a turn',
  kind => {
    const f = registryWaitFixture()
    const events: AgentRunEvent[] = []
    const cursor = f.registry.list()
    f.registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event => {
      if (event.type !== 'resync_required') {
        events.push(event)
      }
    })
    let reentered = false
    f.registry.watchFence(f.registry.readFence({ nodeId: 'n' })!, () => {
      if (reentered) {
        return
      }
      reentered = true
      f.registry.observe('s', {
        incarnation: kind === 'registration' ? 'new' : 'i',
        source: 'codex_hook',
        sourceSequence: 1,
        observedAt: 200,
        state: 'working',
        boundary: { kind: 'start', evidence: 'task_started' },
      })
    })
    if (kind === 'registration') {
      f.registry.register({ sessionId: 's', nodeId: 'n', incarnation: 'new', provider: 'codex' })
    } else {
      f.registry.bind('s', { nodeId: 'new-node' })
    }
    try {
      expect(reentered).toBe(true)
      expect(events.map(event => event.snapshot.state)).toEqual(['unknown', 'working'])
      expect(events[0].snapshot.turn).toBeNull()
    } finally {
      f.registry.dispose()
    }
  },
)
