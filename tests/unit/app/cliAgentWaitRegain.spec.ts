// @vitest-environment node
import { expect, it, vi } from 'vitest'
import * as entries from '../../../src/contexts/agent/application/AgentRunStateEntry'
import type { WaitUntil } from '../../../src/app/cli/core/agentWait'
import { ownerFixture } from './agentWaitOwners.helpers'

const tick = () => new Promise(resolve => setImmediate(resolve))

it.each(
  ['other', null].flatMap(movedNode =>
    ['idle', 'waiting', 'exited', 'turn-end', 'exact'].map(mode => ({ movedNode, mode })),
  ),
)(
  'follows a legacy owner regain after moving to $movedNode (mode=$mode)',
  async ({ movedNode, mode }) => {
    // Before ownership publication, claiming a binding only replaced the map entry:
    // both displaced sessions kept their nodeId and neither published a null loss.
    const claim = vi
      .spyOn(entries, 'claimRunNodeBinding')
      .mockImplementation((bindings, nodeId, entry) => {
        if (nodeId !== null) {
          bindings.set(nodeId, entry)
        }
        return () => {}
      })
    const f = ownerFixture(true, false)
    f.observe('working', 'start')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    const gets = () => f.query.mock.calls.filter(([id]) => id === 'agent.get').length
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      await tick()
      return original(id, payload)
    })
    let traffic = 0
    let timer = setInterval(() => f.observe(++traffic % 2 ? 'waiting' : 'working'), 1)
    const pending = f
      .wait(
        ['n'],
        mode === 'exact' ? 't2' : undefined,
        false,
        mode === 'exact' ? 'idle' : (mode as WaitUntil),
      )
      .then(
        value => ({ value }),
        error => ({ error }),
      )
    try {
      await vi.waitFor(() => expect(gets()).toBe(2))
      await vi.waitFor(() => expect(traffic).toBeGreaterThan(10))
      expect(gets()).toBe(2)
      clearInterval(timer)
      f.observe('working')
      f.registry.bind('s', { nodeId: movedNode })
      f.registry.bind('s', { nodeId: 'n' })
      expect(f.registry.get({ nodeId: 'n' })?.sessionId).toBe('s')
      expect(f.registry.get({ sessionId: 'r' })?.nodeId).toBe('n')
      expect(
        f.events.some(event => event.snapshot.sessionId === 'r' && event.snapshot.nodeId === null),
      ).toBe(false)
      if (mode === 'exact') {
        f.observeSession('r', 'idle', 'completed')
        expect(await pending).toMatchObject({
          error: {
            code: 'agent.wait_turn_unavailable',
            exitCode: 1,
            details: { reason: 'turn_not_found', sessionId: 's', turnId: 't2' },
          },
        })
      } else {
        let displacedTraffic = 0
        timer = setInterval(
          () => f.observeSession('r', ++displacedTraffic % 2 ? 'waiting' : 'working'),
          1,
        )
        await vi.waitFor(() => expect(displacedTraffic).toBeGreaterThan(10))
        expect(gets()).toBeLessThanOrEqual(4)
        if (mode === 'exited') {
          f.registry.observe('s', {
            incarnation: 'i',
            source: 'exit',
            sourceSequence: 1,
            observedAt: 2000,
            state: 'exited',
          })
        } else {
          f.observe(
            mode === 'waiting' ? 'waiting' : 'idle',
            mode === 'waiting' ? undefined : 'completed',
          )
        }
        expect(await pending).toMatchObject({
          value: {
            agents: [{ sessionId: 's', nodeId: 'n', state: mode === 'turn-end' ? 'idle' : mode }],
          },
        })
      }
      expect(gets()).toBeGreaterThanOrEqual(3)
      expect(gets()).toBeLessThanOrEqual(4)
    } finally {
      clearInterval(timer)
      f.controller.abort()
      await pending
      f.registry.dispose()
      claim.mockRestore()
    }
  },
)
