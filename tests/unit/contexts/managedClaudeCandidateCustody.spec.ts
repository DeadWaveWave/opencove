// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { faultHarness } from './managedClaudeFaultHarness'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => vi.useRealTimers())

it.each(['launch', 'recovery'] as const)(
  'keeps node A candidate alive while node B starts independent %s',
  async kind => {
    const f = await faultHarness({
      initial: 'owned',
      fault: 'none',
      event: 'none',
      edge: 'identity:before',
    })
    if (kind === 'recovery') {
      for (const model of f.models) {
        model.alive.clear()
        model.changedByOther = true
      }
    }
    f.pause('agent')
    try {
      if (kind === 'launch') {
        f.start()
      } else {
        f.prepare('agent', 'primary')
      }
      await f.until(() => f.paused('agent'))
      const candidate = [...f.model.created.keys()][0]
      expect(f.model.alive.has(candidate)).toBe(true)
      const other =
        kind === 'launch' ? f.launch('peer-launch', 'peer') : f.prepare('peer', 'peer-prepare')
      await f.until(() => other.done)
      expect(other.value).toMatchObject({ ok: true })
      expect(f.model.alive.has(candidate)).toBe(true)
      expect(f.model.killAttempts.has(candidate)).toBe(false)
      f.release('agent')
      await f.settle()
      expect(f.primary()).toMatchObject({ ok: true })
      for (const model of f.models) {
        expect(model.binding?.runtimeSessionId).toBe(model.nodeRuntime)
        expect(model.alive.has(model.nodeRuntime!)).toBe(true)
        model.assertValid()
      }
    } finally {
      f.release('agent')
      f.dispose()
    }
  },
)

it('deletes node B while node A candidate awaits activation without cleaning node A', async () => {
  const f = await faultHarness({
    initial: 'adoption',
    fault: 'none',
    event: 'none',
    edge: 'identity:before',
  })
  f.pause('agent')
  try {
    f.start()
    await f.until(() => f.paused('agent'))
    const candidate = [...f.model.created.keys()][0]
    f.remove('peer')
    await f.until(() => !f.peer.alive.has(f.peer.original))
    expect(f.model.alive.has(candidate)).toBe(true)
    f.release('agent')
    await f.settle()
    expect(f.primary()).toMatchObject({ ok: true })
    f.models.forEach(model => model.assertValid())
  } finally {
    f.release('agent')
    f.dispose()
  }
})

it.each(['onStarted', 'registration'] as const)(
  'cleans first-adoption candidate before reporting %s failure with healthy cleanup ports',
  async fault => {
    const f = await faultHarness({
      initial: 'adoption',
      fault,
      event: 'none',
      edge: 'identity:before',
    })
    try {
      f.start()
      await f.completePrimary()
      expect(f.primary()).toMatchObject({ ok: false, error: { code: 'agent.launch_failed' } })
      const candidate = [...f.model.created.keys()][0]
      expect(candidate).toBeDefined()
      expect(f.model.alive.has(candidate)).toBe(false)
      expect(f.model.killAttempts.get(candidate)).toBe(1)
      expect(f.pending()).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      expect(f.model.nodeRuntime).toBe(f.model.original)
      expect(f.model.alive.has(f.model.original)).toBe(true)
      await f.settle()
      f.models.forEach(model => model.assertValid())
    } finally {
      f.dispose()
    }
  },
)

it('reconciles unknown activation after a read outage outlasts the initial retry budget', async () => {
  const f = await faultHarness({
    initial: 'fallback',
    fault: 'activationUnknownCommitted',
    event: 'none',
    edge: 'identity:before',
    outageRetries: 4,
  })
  try {
    f.start()
    await f.settle()
    expect(f.primary()).toMatchObject({
      ok: false,
      error: { code: 'agent.managed_launch_commit_failed' },
    })
    expect(f.model.alive.has(f.model.original)).toBe(false)
    expect(f.model.alive.has(f.model.binding!.runtimeSessionId!)).toBe(true)
    expect(f.pending()).toEqual([])
    f.models.forEach(model => model.assertValid())
  } finally {
    f.dispose()
  }
})

it('refuses an unreferenced-cleanup request for an active candidate before activation', async () => {
  const f = await faultHarness({
    initial: 'adoption',
    fault: 'none',
    event: 'none',
    edge: 'identity:before',
  })
  f.pause('agent')
  try {
    f.start()
    await f.until(() => f.paused('agent'))
    const candidate = [...f.model.created.keys()][0]
    expect(await f.cleanup(candidate)).toMatchObject({ ok: true, value: { cleaned: false } })
    expect(f.model.alive.has(candidate)).toBe(true)
    expect(f.model.killAttempts.has(candidate)).toBe(false)
    f.release('agent')
    await f.settle()
    expect(f.primary()).toMatchObject({ ok: true })
    f.models.forEach(model => model.assertValid())
  } finally {
    f.release('agent')
    f.dispose()
  }
})
