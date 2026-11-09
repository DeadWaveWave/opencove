// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ownerFixture } from './agentWaitOwners.helpers'
import type { WaitUntil } from '../../../src/app/cli/core/agentWait'

it.each(
  [false, true].flatMap(legacy => ['idle', 'exited', 'exact'].map(mode => ({ legacy, mode }))),
)(
  'uses the exited replacement while the displaced session is still live (legacy=$legacy, mode=$mode)',
  async ({ legacy, mode }) => {
    const f = ownerFixture(legacy)
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    f.observeSession('r', 'exited')
    try {
      const pending = f.wait(
        ['n'],
        mode === 'exact' ? 't2' : undefined,
        false,
        mode === 'exited' ? 'exited' : 'idle',
        250,
      )
      if (mode === 'idle') {
        await expect(pending).rejects.toMatchObject({
          exitCode: 11,
          details: {
            targets: [
              expect.objectContaining({ sessionId: 'r', state: 'exited', status: 'exited' }),
            ],
          },
        })
      } else {
        expect(await pending).toMatchObject(
          mode === 'exact'
            ? { sessionId: 'r', turnId: 't2', outcome: 'unknown', state: 'exited' }
            : { agents: [{ sessionId: 'r', state: 'exited' }] },
        )
      }
      expect(f.query.mock.calls.filter(([id]) => id === 'agent.get')).toHaveLength(1)
    } finally {
      f.controller.abort()
      f.registry.dispose()
    }
  },
)
it.each(
  [false, true].flatMap(legacy =>
    ['idle', 'waiting', 'exited', 'turn-end', 'exact'].map(mode => ({ legacy, mode })),
  ),
)(
  'bounds owner queries while a displaced session emits continuously (legacy=$legacy, mode=$mode)',
  async ({ legacy, mode }) => {
    const f = ownerFixture(legacy)
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      await new Promise(resolve => setTimeout(resolve, 3))
      return original(id, payload)
    })
    let traffic = 0
    const timer = setInterval(() => f.observe(++traffic % 2 ? 'working' : 'waiting'), 1)
    const completion = setTimeout(
      () =>
        f.observeSession(
          'r',
          mode === 'waiting' ? 'waiting' : mode === 'exited' ? 'exited' : 'idle',
          mode === 'waiting' || mode === 'exited' ? undefined : 'completed',
        ),
      30,
    )
    try {
      const pending = f.wait(
        ['n'],
        mode === 'exact' ? 't2' : undefined,
        false,
        mode === 'exact' ? 'idle' : (mode as WaitUntil),
        300,
      )
      expect(await pending).toMatchObject(
        mode === 'exact'
          ? { sessionId: 'r', turnId: 't2', outcome: 'completed' }
          : { agents: [{ sessionId: 'r', state: mode === 'turn-end' ? 'idle' : mode }] },
      )
      const gets = f.query.mock.calls.filter(([id]) => id === 'agent.get').length
      expect(gets).toBeGreaterThanOrEqual(1)
      expect(gets).toBeLessThanOrEqual(2)
      expect(traffic).toBeGreaterThan(5)
      expect(f.query.mock.calls.filter(([id]) => id === 'agent.list').length).toBeLessThanOrEqual(4)
    } finally {
      clearInterval(timer)
      clearTimeout(completion)
      f.controller.abort()
      f.registry.dispose()
    }
  },
)

it('can select a previously ignored session again after the current owner publishes null', async () => {
  const f = ownerFixture(true)
  f.observe('working', 'start')
  f.observe('idle', 'completed')
  f.register('r')
  f.observeSession('r', 'working', 'start')
  const pending = f.wait()
  try {
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
    f.observe('working')
    await vi.waitFor(() =>
      expect(f.query.mock.calls.filter(([id]) => id === 'agent.get')).toHaveLength(2),
    )
    f.registry.bind('s', { nodeId: 'n' })
    f.observe('idle', 'completed')
    expect((await pending).agents[0]).toMatchObject({ sessionId: 's', nodeId: 'n', state: 'idle' })
    expect(f.query.mock.calls.filter(([id]) => id === 'agent.get')).toHaveLength(3)
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})
