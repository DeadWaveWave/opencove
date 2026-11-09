// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { ownerFixture } from './agentWaitOwners.helpers'
import { fixture, snapshot } from './cliAgentWait.helpers'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'

const tick = () => new Promise(resolve => setImmediate(resolve))
it.each(['before', 'during'] as const)(
  'ignores an unrelated replacement exit %s subscription while the selected turn runs',
  async when => {
    const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
    const f = registryWaitFixture(false, false, archive)
    f.observe('working', 'start')
    const replaceAndExit = () => {
      f.registry.register({ sessionId: 'r', nodeId: 'n', incarnation: 'r', provider: 'codex' })
      f.registry.observe('r', {
        incarnation: 'r',
        source: 'codex_hook',
        sourceSequence: 1,
        observedAt: 1000,
        state: 'working',
        boundary: { kind: 'start', evidence: 'task_started' },
      })
      f.registry.observe('r', {
        incarnation: 'r',
        source: 'exit',
        sourceSequence: 2,
        observedAt: 1001,
        state: 'exited',
      })
    }
    if (when === 'before') {
      replaceAndExit()
    }
    let settled = false
    const pending = f.wait('t1').then(
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
      await tick()
      if (when === 'during') {
        replaceAndExit()
      }
      await tick()
      expect(f.registry.get({ sessionId: 's' })).toMatchObject({
        state: 'working',
        turn: { id: 't1' },
      })
      expect(settled).toBe(false)
      f.observe('idle', 'completed')
      await expect(pending).resolves.toMatchObject({
        value: { sessionId: 's', turnId: 't1', outcome: 'completed' },
      })
      expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    } finally {
      await pending
      f.registry.dispose()
      archive.dispose()
    }
  },
)

it.each(['fulfilled', 'pending'] as const)(
  'makes a live-unbound %s target fail as missing after reconciliation',
  async status => {
    const f = ownerFixture()
    f.observe('working', 'start')
    f.register('b', 'b')
    f.observeSession('b', 'working', 'start')
    const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'agent.not_running',
      exitCode: 1,
    })
    try {
      await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
      if (status === 'fulfilled') {
        f.observe('idle', 'failed')
        await tick()
      }
      f.registry.bind('s', { nodeId: null })
      await assertion
      expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    } finally {
      f.controller.abort()
      await pending.catch(() => {})
      f.registry.dispose()
    }
  },
)

it.each([true, false])(
  'rejects an unbound target found after resync (previously fulfilled=%s)',
  async fulfilled => {
    const f = fixture([snapshot('a'), snapshot('b')])
    const pending = f.wait('turn-end', ['a', 'b'])
    const assertion = expect(pending).rejects.toMatchObject({ code: 'agent.not_running' })
    try {
      await vi.waitFor(() => expect(f.streams).toHaveLength(1))
      if (fulfilled) {
        f.streams[0].send(f.event('a', 'idle', true))
        await tick()
      }
      f.states.splice(0, 1)
      f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 6 })
      await assertion
      expect(f.streams.every(stream => stream.cancelled)).toBe(true)
    } finally {
      f.controller.abort()
      await pending.catch(() => {})
    }
  },
)
it('checks B attention at the shared cursor before reporting A’s missing binding', async () => {
  const f = ownerFixture()
  f.observe('working', 'start')
  f.register('b', 'b')
  f.observeSession('b', 'working', 'start')
  const pending = f.wait(['n', 'b'], undefined, false, 'turn-end')
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'agent.wait_attention',
    exitCode: 10,
    details: {
      targets: [
        { nodeId: 'n', sessionId: null, status: 'pending', state: 'unknown' },
        expect.objectContaining({ nodeId: 'b', status: 'waiting' }),
      ],
    },
  })
  try {
    await vi.waitFor(() => expect(f.subscriptions().opened).toBe(1))
    f.observe('idle', 'completed')
    await tick()
    f.registry.bind('s', { nodeId: null })
    f.observeSession('b', 'waiting')
    await assertion
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
