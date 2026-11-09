// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ownerFixture } from './agentWaitOwners.helpers'
import { fixture, snapshot } from './cliAgentWait.helpers'

const tick = () => new Promise(resolve => setImmediate(resolve))
function twoTargets() {
  const f = ownerFixture()
  f.observe('working', 'start')
  f.register('b', 'b')
  f.observeSession('b', 'working', 'start')
  return f
}
it('does not transfer A’s completion when its waiting session moves onto B', async () => {
  const f = twoTargets()
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'agent.wait_attention',
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'n', status: 'pending' }),
        expect.objectContaining({ nodeId: 'b', sessionId: 's', status: 'waiting' }),
      ],
    },
  })
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'failed')
    await tick()
    f.observe('working', 'start')
    f.observe('waiting')
    await tick()
    f.registry.bind('s', { nodeId: 'b' })
    await assertion
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
it('waits for a replacement’s own completion and reports its explicit session identity', async () => {
  const f = twoTargets()
  let settled = false
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end').then(
    value => {
      settled = true
      return { value }
    },
    error => {
      settled = true
      return { error }
    },
  )
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'failed')
    await tick()
    f.register('replacement')
    f.observeSession('replacement', 'working', 'start')
    await tick()
    f.observeSession('b', 'idle', 'completed')
    await tick()
    expect(settled).toBe(false)
    const replacementTurn = f.registry.get({ sessionId: 'replacement' })!.turn!.id
    f.observeSession('replacement', 'idle', 'completed')
    const result = await pending
    expect(result).toMatchObject({
      value: {
        agents: [
          {
            nodeId: 'n',
            sessionId: 'replacement',
            completion: {
              nodeId: 'n',
              sessionId: 'replacement',
              turnId: replacementTurn,
              outcome: 'completed',
            },
          },
          { nodeId: 'b', completion: { sessionId: 'b', outcome: 'completed' } },
        ],
      },
    })
    // The CLI's explicit completion identity must identify real retained Worker evidence.
    const end = await f
      .query('agent.finalMessage', { sessionId: 'replacement', turnId: replacementTurn })
      .catch(error => {
        expect(error).toMatchObject({
          code: 'agent.final_message_unavailable',
          details: { reason: 'provider_sent_no_message' },
        })
        return error.details
      })
    expect(end).toMatchObject({
      sessionId: 'replacement',
      turnId: replacementTurn,
      outcome: 'completed',
    })
  } finally {
    f.controller.abort()
    await pending
    f.registry.dispose()
  }
})
it('makes a fulfilled target pending when its binding changes', async () => {
  const f = twoTargets()
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'n', sessionId: 'replacement', status: 'pending' }),
        expect.objectContaining({ nodeId: 'b', status: 'waiting' }),
      ],
    },
  })
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'completed')
    await tick()
    f.register('replacement')
    f.observeSession('replacement', 'working', 'start')
    await tick()
    f.observeSession('b', 'waiting')
    await assertion
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
it('returns a completion session separately even while the same binding starts a newer turn', async () => {
  const f = twoTargets()
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'failed')
    f.observe('working', 'start')
    await tick()
    f.observeSession('b', 'idle', 'completed')
    await expect(pending).resolves.toMatchObject({
      agents: [
        {
          nodeId: 'n',
          state: 'working',
          completion: { nodeId: 'n', sessionId: 's', turnId: 't1', outcome: 'failed' },
        },
        { nodeId: 'b', completion: { sessionId: 'b' } },
      ],
    })
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
it('drops fulfillment on a replacement discovered after resync', async () => {
  const f = fixture([snapshot('a'), snapshot('b')])
  const pending = f.wait('turn-end', ['a', 'b'])
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'a', sessionId: 'replacement', status: 'pending' }),
        expect.objectContaining({ nodeId: 'b', status: 'waiting' }),
      ],
    },
  })
  try {
    await vi.waitFor(() => expect(f.streams).toHaveLength(1))
    f.streams[0].send(f.event('a', 'idle', true))
    await tick()
    f.states[0] = { ...snapshot('a'), sessionId: 'replacement' }
    f.states[1] = snapshot('b', 'waiting')
    f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 6 })
    await assertion
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
  }
})
it('requires a new completion even if the same session quickly leaves and reclaims the node', async () => {
  const f = twoTargets()
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'n', sessionId: 's', status: 'pending' }),
        expect.objectContaining({ nodeId: 'b', status: 'waiting' }),
      ],
    },
  })
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'completed')
    await tick()
    f.registry.bind('s', { nodeId: 'other' })
    f.registry.bind('s', { nodeId: 'n' })
    f.observeSession('b', 'waiting')
    await assertion
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
