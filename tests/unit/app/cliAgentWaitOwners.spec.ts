// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ownerFixture as fixture } from './agentWaitOwners.helpers'

const tick = () => new Promise(resolve => setImmediate(resolve))
it.each([
  { exact: false, legacy: false },
  { exact: true, legacy: false },
  { exact: false, legacy: true },
  { exact: true, legacy: true },
])(
  'selects the current owner from displaced live entries (exact=$exact, legacy=$legacy)',
  async ({ exact, legacy }) => {
    const f = fixture(legacy)
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    let settled = false
    const pending = f.wait(['n'], exact ? 't2' : undefined).then(
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
      await tick()
      expect(settled).toBe(false)
      await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
      expect(
        f.query.mock.calls.some(
          ([id, payload]) => id === 'agent.get' && (payload as { nodeId: string }).nodeId === 'n',
        ),
      ).toBe(true)
      f.observeSession('r', 'idle', 'completed')
      expect(await pending).toMatchObject(
        exact
          ? { value: { turnId: 't2', sessionId: 'r', outcome: 'completed' } }
          : { value: { agents: [{ sessionId: 'r', state: 'idle' }] } },
      )
    } finally {
      f.controller.abort()
      await pending
      f.registry.dispose()
    }
  },
)
it.each([false, true])(
  'reconciles mixed list/get baselines before satisfaction (any=%s)',
  async any => {
    const f = fixture()
    f.observe('idle', 'completed')
    f.register('b', 'b')
    f.observeSession('b', 'exited')
    const original = f.query.getMockImplementation()!
    let replaced = false
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.get' && (payload as { nodeId: string }).nodeId === 'b' && !replaced) {
        replaced = true
        f.observe('working', 'start')
        f.register('replacement-b', 'b')
        f.observeSession('replacement-b', any ? 'working' : 'idle', any ? 'start' : undefined)
      }
      return original(id, payload)
    })
    let settled = false
    const pending = f.wait(['n', 'b'], undefined, any).then(value => {
      settled = true
      return value
    })
    try {
      await tick()
      expect(settled).toBe(false)
      await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
      f.observe('idle', 'completed')
      expect((await pending).agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sessionId: 's', state: 'idle' }),
          expect.objectContaining({ sessionId: 'replacement-b' }),
        ]),
      )
    } finally {
      f.controller.abort()
      await pending.catch(() => {})
      f.registry.dispose()
    }
  },
)
it('re-resolves rebinding and ignores a displaced session completion after the baseline', async () => {
  const f = fixture()
  f.observe('working', 'start')
  let settled = false
  const pending = f.wait().then(value => {
    settled = true
    return value
  })
  try {
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
    f.register('r')
    f.observeSession('r', 'working', 'start')
    f.observe('idle', 'completed')
    await tick()
    expect(settled).toBe(false)
    f.observeSession('r', 'idle', 'completed')
    expect((await pending).agents[0]).toMatchObject({ sessionId: 'r', state: 'idle' })
  } finally {
    f.controller.abort()
    await pending.catch(() => {})
    f.registry.dispose()
  }
})

it.each([false, true])(
  'retains an owner completion during provisional replay before newer turns evict it (legacy=%s)',
  async legacy => {
    const f = fixture(legacy)
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    const original = f.query.getMockImplementation()!
    let advanced = false
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.get' && !advanced) {
        advanced = true
        f.observeSession('r', 'idle', 'completed')
        for (let i = 0; i < 8; i++) {
          f.observeSession('r', 'working', 'start')
          f.observeSession('r', 'idle', 'completed')
        }
      }
      return original(id, payload)
    })
    try {
      expect(await f.wait(['n'], 't2')).toMatchObject({
        turnId: 't2',
        sessionId: 'r',
        outcome: 'completed',
      })
    } finally {
      f.controller.abort()
      f.registry.dispose()
    }
  },
)

it.each([false, true])(
  'returns the reconciled owner state after retaining an earlier end (legacy=%s)',
  async legacy => {
    const f = fixture(legacy)
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.register('r')
    f.observeSession('r', 'working', 'start')
    const original = f.query.getMockImplementation()!
    let advanced = false
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.get' && !advanced) {
        advanced = true
        f.observeSession('r', 'idle', 'completed')
        f.observeSession('r', 'working', 'start')
      }
      return original(id, payload)
    })
    try {
      expect(await f.wait(['n'], 't2')).toMatchObject({
        turnId: 't2',
        sessionId: 'r',
        outcome: 'completed',
        state: 'working',
      })
    } finally {
      f.controller.abort()
      f.registry.dispose()
    }
  },
)
