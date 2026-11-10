import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
const pair = (id: string, session = 'provider') => ({
  providerTurnId: id,
  providerSessionId: session,
})
function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  const send = (id: string) =>
    f.service.deliver({
      nodeId: 'n',
      text: 'prompt',
      timeoutMs: 15000,
      whenBusy: 'steer',
      deliveryId: id,
    })
  return { ...f, send }
}
it('excludes pre-fence ended pairs and correlates a post-fence late receipt without reopening it', async () => {
  const f = fixture()
  try {
    for (const id of ['A', 'B']) {
      vi.setSystemTime(Date.now() + 1)
      f.observe('UserPromptSubmit', Date.now(), pair(id))
      f.observe('Stop', Date.now(), pair(id))
    }
    const p = f.send('C'),
      failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), pair('A'))
    expect(f.service.get('C')).toMatchObject({ status: 'pending' })
    f.observe('UserPromptSubmit', undefined, pair('C'))
    f.observe('Stop', Date.now(), pair('C'))
    await vi.advanceTimersByTimeAsync(5000)
    await failed
    f.observe('UserPromptSubmit', Date.now(), pair('C'))
    expect(f.service.get('C')).toMatchObject({ status: 'submitted', turnId: 'turn-3' })
    expect(f.registry.get({ nodeId: 'n' })!.turn).toBeNull()
  } finally {
    f.dispose()
  }
})
it('requires a known steering pair and confirms exactly one FIFO delivery per receipt', async () => {
  const f = fixture()
  try {
    f.observe('UserPromptSubmit', Date.now(), pair('A'))
    for (const id of ['one', 'two']) {
      const p = f.send(id)
      // Dispatch in order to exercise the real FIFO rather than concurrent admission.
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(300)
      // eslint-disable-next-line no-await-in-loop
      await expect(p).resolves.toMatchObject({
        mode: 'steer',
        phase: 'dispatched',
        textComparison: 'unavailable',
      })
    }
    for (const evidence of [
      pair('wrong'),
      pair('A', 'wrong'),
      {},
      { providerSessionId: 'provider' },
    ]) {
      f.observe('UserPromptSubmit', 'providerTurnId' in evidence ? 1000 : Date.now(), evidence)
      expect(f.service.get('one')).toMatchObject({ status: 'dispatched' })
    }
    f.observe('UserPromptSubmit', 0, pair('A'))
    expect(f.service.get('one')).toMatchObject({ status: 'dispatched' })
    f.observe('UserPromptSubmit', Date.now(), pair('A'))
    expect(f.service.get('one')).toMatchObject({ status: 'submitted', turnId: 'turn' })
    expect(f.service.get('two')).toMatchObject({ status: 'dispatched' })
    f.observe('UserPromptSubmit', Date.now(), pair('A'))
    expect(f.service.get('two')).toMatchObject({ status: 'submitted', turnId: 'turn' })
    f.observe('Stop', Date.now(), pair('A'))
    expect(f.registry.get({ nodeId: 'n' })!.lastEndedTurn?.id).toBe('turn')
  } finally {
    f.dispose()
  }
})
it('never associates an unrecognized complete pair receipt with the current local turn', async () => {
  const f = fixture(),
    receipts: unknown[] = []
  try {
    f.observe('UserPromptSubmit', Date.now(), pair('A'))
    f.registry.watchSubmissionEvidence(f.registry.readFence({ nodeId: 'n' })!, r =>
      receipts.push(r),
    )
    // Equal relay time cannot supersede A, even though the receipt arrives later.
    f.observe('UserPromptSubmit', Date.now(), pair('B'))
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ providerTurnId: 'B', turnId: undefined })
    expect(f.registry.get({ nodeId: 'n' })!.turn?.id).toBe('turn')
  } finally {
    f.dispose()
  }
})

it('keeps pre-fence pair exclusion after its reply has left the smaller message cache', async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 65; i++) {
      vi.setSystemTime(Date.now() + 1)
      f.observe('UserPromptSubmit', Date.now(), pair(`A${i}`))
      f.observe('Stop', Date.now(), pair(`A${i}`))
    }
    const p = f.send('new'),
      failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), pair('A0'))
    expect(f.service.get('new')).toMatchObject({ status: 'pending' })
    expect(f.registry.get({ nodeId: 'n' })!.turn).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    await failed
  } finally {
    f.dispose()
  }
})
