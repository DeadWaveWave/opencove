// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ownerFixture } from './agentWaitOwners.helpers'

const tick = () => new Promise(resolve => setImmediate(resolve))
function setup() {
  const f = ownerFixture()
  f.observe('working', 'start') // A: t1
  f.register('b', 'b')
  f.observeSession('b', 'working', 'start') // B: t2
  return f
}
it.each(['live', 'replay'] as const)(
  'reports the same first failed completion with %s delivery of failed then completed turns',
  async delivery => {
    const f = setup()
    const finishLater = () => {
      f.observe('working', 'start') // A: t3
      f.observe('idle', 'completed')
      f.observeSession('b', 'idle', 'completed')
    }
    if (delivery === 'replay') {
      f.onSubscribe(() => {
        // The post-subscription watermark sees the entire batch, before its replay is read.
        f.observe('idle', 'failed')
        finishLater()
      })
    }
    const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
    try {
      if (delivery === 'live') {
        await vi.waitFor(() =>
          expect(f.query.mock.calls.filter(([id]) => id === 'agent.list')).toHaveLength(3),
        )
        f.observe('idle', 'failed')
        await tick() // Reconciled before A's next turn, unlike the replay branch.
        finishLater()
      }
      const result = await pending
      const [a, b] = result.agents
      expect(a).toMatchObject({
        nodeId: 'n',
        sessionId: 's',
        state: 'idle',
        turnOutcome: 'completed',
        lastEndedTurn: { id: 't3', outcome: 'completed' },
        completion: { nodeId: 'n', sessionId: 's', turnId: 't1', outcome: 'failed' },
        endedTurn: { id: 't1' },
        endedTurnOutcome: 'failed',
      })
      expect(b).toMatchObject({
        completion: { nodeId: 'b', sessionId: 'b', turnId: 't2', outcome: 'completed' },
      })
      expect(
        f.events
          .filter(
            event => event.type === 'agent.turn_completed' && event.snapshot.sessionId === 's',
          )
          .map(event => [event.endedTurn!.id, event.snapshot.turnOutcome]),
      ).toEqual([
        ['t1', 'failed'],
        ['t3', 'completed'],
      ])
      expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    } finally {
      f.controller.abort()
      await pending.catch(() => {})
      f.registry.dispose()
    }
  },
)
it('discards the first provisional completion when the binding leaves and reclaims before reconciliation', async () => {
  const f = setup()
  f.onSubscribe(() => {
    f.observe('idle', 'failed')
    f.registry.bind('s', { nodeId: 'other' })
    f.registry.bind('s', { nodeId: 'n' })
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.observeSession('b', 'idle', 'completed')
  })
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  try {
    await expect(pending).resolves.toMatchObject({
      agents: [
        {
          nodeId: 'n',
          completion: { sessionId: 's', turnId: 't3', outcome: 'completed' },
          endedTurn: { id: 't3' },
          endedTurnOutcome: 'completed',
        },
        { nodeId: 'b', completion: { turnId: 't2', outcome: 'completed' } },
      ],
    })
    expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
