import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
function working(provider: 'claude-code' | 'codex' = 'codex') {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, provider)
  f.observe('UserPromptSubmit', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
  const send = (deliveryId: string) =>
    f.service.deliver({
      nodeId: 'n',
      text: 'prompt',
      timeoutMs: 15000,
      whenBusy: 'steer',
      deliveryId,
    })
  const dispatch = async (id: string) => {
    const p = send(id)
    await vi.advanceTimersByTimeAsync(300)
    return p
  }
  return { ...f, send, dispatch }
}
it('rejects older retained turn mappings while allowing a post-fence late receipt', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  let nextTurn = 0
  const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', true, () => `turn-${++nextTurn}`)
  try {
    for (const promptId of ['A', 'B']) {
      vi.setSystemTime(Date.now() + 1)
      f.observe('UserPromptSubmit', Date.now(), { promptId, providerSessionId: 'provider' })
      f.observe('Stop', Date.now(), { promptId, providerSessionId: 'provider' })
    }
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'C',
      timeoutMs: 15000,
      whenBusy: 'steer',
      deliveryId: 'C',
    })
    const failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'A', providerSessionId: 'provider' })
    expect(f.service.get('C')).toMatchObject({ status: 'pending' })
    f.observe('UserPromptSubmit', undefined, { promptId: 'C', providerSessionId: 'provider' })
    f.observe('Stop', Date.now(), { promptId: 'C', providerSessionId: 'provider' })
    await vi.advanceTimersByTimeAsync(5000)
    await failed
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'C', providerSessionId: 'provider' })
    expect(f.service.get('C')).toMatchObject({ status: 'submitted', turnId: 'turn-3' })
  } finally {
    f.dispose()
  }
})
it('uncertain Codex CR failure is unknown, FIFO-ineligible and blocks later delivery', async () => {
  const f = working()
  try {
    f.write.mockImplementation((_id, data) => {
      if (data === '\r') {
        throw new Error('write failed')
      }
    })
    const p = f.send('failed')
    const failed = expect(p).rejects.toMatchObject({
      code: 'agent.prompt_stalled',
      details: { submitDispatchAttempted: true },
    })
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.service.get('failed')).toMatchObject({ status: 'unknown' })
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('failed')).toMatchObject({ status: 'unknown' })
    await expect(f.send('next')).rejects.toMatchObject({ code: 'agent.delivery_unsettled' })
    expect(f.write).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})
it('queued competing human input cancels the following delivery before paste', async () => {
  const f = working()
  let release!: () => void
  try {
    await f.dispatch('first')
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const held = f.hub.withSessionInputOperation('s', async () => gate)
    const human = f.hub.withSessionInputOperation('s', async input => input.write('human'))
    const p = f.send('queued')
    const failed = expect(p).rejects.toMatchObject({
      details: {
        reason: 'delivery_in_progress',
        deliveryId: 'first',
        pasteDispatchAttempted: false,
        submitDispatchAttempted: false,
      },
    })
    release()
    await held
    await human
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.write.mock.calls.map(c => c[1])).toEqual(['\x1b[200~prompt\x1b[201~', '\r', 'human'])
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('first')).toMatchObject({ status: 'ambiguous' })
    expect(f.service.get('queued')).toMatchObject({ status: 'not_sent' })
  } finally {
    release?.()
    f.dispose()
  }
})
it('earlier dispatch becoming unknown during the paste interval cancels CR', async () => {
  const f = working()
  try {
    await f.dispatch('first')
    const p = f.send('second')
    const failed = expect(p).rejects.toMatchObject({
      code: 'agent.prompt_interrupted',
      details: { reason: 'delivery_in_progress', deliveryId: 'first' },
    })
    await vi.advanceTimersByTimeAsync(0)
    f.observe('Stop', Date.now())
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.write).toHaveBeenCalledTimes(3)
    expect(f.service.get('second')).toMatchObject({ status: 'not_sent' })
  } finally {
    f.dispose()
  }
})

it('synchronous submission evidence survives a subsequent uncertain CR write exception', async () => {
  const f = working()
  try {
    f.write.mockImplementation((_id, data) => {
      if (data === '\r') {
        f.observe('UserPromptSubmit', Date.now())
        throw new Error('uncertain write completion')
      }
    })
    const p = f.send('confirmed')
    await vi.advanceTimersByTimeAsync(300)
    await expect(p).resolves.toMatchObject({ phase: 'submission_observed' })
    expect(f.service.get('confirmed')).toMatchObject({ status: 'submitted' })
  } finally {
    f.dispose()
  }
})
