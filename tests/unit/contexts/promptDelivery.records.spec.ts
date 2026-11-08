/* eslint-disable no-await-in-loop -- dispatch order and queue capacity are the invariants under test */
import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
function fixture(provider: 'codex' | 'claude-code' = 'codex') {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, provider)
  f.observe('UserPromptSubmit', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
  const send = (deliveryId: string, whenBusy: 'steer' | 'refuse' | undefined = 'steer') =>
    f.service.deliver({ nodeId: 'n', text: 'prompt', timeoutMs: 15000, whenBusy, deliveryId })
  const dispatch = async (id: string) => {
    const p = send(id)
    await vi.advanceTimersByTimeAsync(300)
    return p
  }
  return { ...f, send, dispatch }
}
it('pins unresolved records and refuses capacity before any bytes', async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 32; i++) {
      await f.dispatch(String(i))
    }
    expect(f.write).toHaveBeenCalledTimes(64)
    await expect(f.send('overflow')).rejects.toMatchObject({
      code: 'agent.delivery_unsettled',
      details: { reason: 'delivery_capacity', pasteDispatchAttempted: false },
    })
    expect(f.write).toHaveBeenCalledTimes(64)
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(f.service.get('0')).toMatchObject({
      available: true,
      status: 'dispatched',
      evidenceWindow: 'closed',
      epoch: 'worker',
    })
  } finally {
    f.dispose()
  }
})
it('evicts completed records first and expires them after thirty minutes', async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 32; i++) {
      await f.dispatch(String(i))
      f.observe('UserPromptSubmit', Date.now())
    }
    await f.dispatch('next')
    expect(f.service.get('0')).toMatchObject({ available: false, reason: 'unavailable' })
    expect(f.service.get('1')).toMatchObject({ status: 'submitted' })
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(f.service.get('1')).toMatchObject({ available: false })
    expect(f.service.get('next')).toMatchObject({ status: 'dispatched' })
  } finally {
    f.dispose()
  }
})
it.each(['Stop', 'turn_aborted'] as const)(
  'Codex %s leaves outstanding steers unknown',
  async event => {
    const f = fixture()
    try {
      await f.dispatch('one')
      await f.dispatch('two')
      f.observe(event, Date.now())
      expect(f.service.get('one')).toMatchObject({ status: 'unknown', evidenceWindow: 'closed' })
      expect(f.service.get('two')).toMatchObject({ status: 'unknown' })
    } finally {
      f.dispose()
    }
  },
)
it.each(['\x03', '\x1b'])('Codex interrupt bytes leave outstanding steers unknown', async data => {
  const f = fixture()
  try {
    await f.dispatch('one')
    await f.hub.withSessionInputOperation('s', async input => input.write(data))
    expect(f.service.get('one')).toMatchObject({ status: 'unknown' })
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('one')).toMatchObject({ status: 'unknown' })
  } finally {
    f.dispose()
  }
})
it('late Claude evidence after turn end upgrades retained uncertainty without reopening state', async () => {
  const f = fixture('claude-code')
  try {
    const p = f.send('late')
    const failure = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(5300)
    await failure
    f.observe('Stop', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
    const before = f.registry.get({ nodeId: 'n' })
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
    expect(f.service.get('late')).toMatchObject({ status: 'submitted', turnId: 'turn' })
    expect(f.registry.get({ nodeId: 'n' })).toEqual(before)
  } finally {
    f.dispose()
  }
})
it('unknown blocks delivery with legacy-safe refusal and a lookup locator', async () => {
  const f = fixture('claude-code')
  try {
    const p = f.send('late')
    const failure = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(5300)
    await failure
    f.observe('Stop', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
    await expect(
      f.service.deliver({ nodeId: 'n', text: 'prompt', timeoutMs: 15000, deliveryId: 'new' }),
    ).rejects.toMatchObject({
      code: 'agent.busy',
      details: { deliveryId: 'late', reason: 'delivery_in_progress' },
    })
    await expect(f.send('new')).rejects.toMatchObject({ code: 'agent.delivery_unsettled' })
    expect(f.write).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})
it('restart or an unknown ID is explicitly unavailable, never not_sent', async () => {
  const f = fixture()
  await f.dispatch('one')
  f.service.dispose()
  expect(f.service.get('one')).toEqual({
    available: false,
    deliveryId: 'one',
    reason: 'unavailable',
  })
  expect(f.service.get('missing')).toMatchObject({ available: false })
  f.dispose()
})

it('duplicate retained CLI IDs never write again', async () => {
  const f = fixture()
  try {
    await f.dispatch('one')
    await expect(f.send('one')).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(f.write).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})
it.each(['stale-time', 'wrong-incarnation', 'wrong-prompt', 'wrong-session'] as const)(
  'late Claude evidence rejects %s without changing the retained result',
  async reason => {
    const f = fixture('claude-code')
    try {
      const p = f.send('late')
      const failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
      await vi.advanceTimersByTimeAsync(5300)
      await failed
      if (reason === 'stale-time') {
        await vi.advanceTimersByTimeAsync(60_001)
        f.observe('UserPromptSubmit', 1300, { promptId: 'active', providerSessionId: 'provider' })
      } else if (reason === 'wrong-incarnation') {
        f.registry.observe(
          's',
          {
            incarnation: 'old',
            source: 'claude_hook',
            sourceSequence: 99,
            state: 'working',
            hookEventName: 'UserPromptSubmit',
            observedAt: Date.now(),
            emittedAtMs: Date.now(),
          },
          { promptId: 'active', providerSessionId: 'provider' },
        )
      } else {
        f.observe('UserPromptSubmit', Date.now(), {
          promptId: reason === 'wrong-prompt' ? 'other' : 'active',
          providerSessionId: reason === 'wrong-session' ? 'other' : 'provider',
        })
      }
      expect(f.service.get('late')).toMatchObject({ status: 'unknown' })
    } finally {
      f.dispose()
    }
  },
)
