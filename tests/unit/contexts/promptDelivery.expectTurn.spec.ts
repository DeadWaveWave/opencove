import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
it.each(['idle', 'different', 'ended-before-cr'] as const)(
  'expect-turn refuses %s instead of opening a new turn',
  async kind => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture(undefined, 'codex')
    try {
      if (kind !== 'idle') {
        f.observe('UserPromptSubmit', Date.now())
      }
      const p = f.service.deliver({
        nodeId: 'n',
        text: 'steer',
        timeoutMs: 15000,
        whenBusy: 'steer',
        deliveryId: 'expected',
        expectTurnId: kind === 'different' ? 'other' : 'turn',
      })
      const failed = expect(p).rejects.toMatchObject({
        details: {
          reason: 'expected_turn_mismatch',
          currentState: expect.any(Object),
          submitDispatchAttempted: false,
        },
      })
      if (kind === 'ended-before-cr') {
        await vi.advanceTimersByTimeAsync(0)
        f.observe('Stop', Date.now())
      }
      await vi.advanceTimersByTimeAsync(300)
      await failed
      expect(f.write).toHaveBeenCalledTimes(kind === 'ended-before-cr' ? 1 : 0)
    } finally {
      f.dispose()
    }
  },
)
it('expect-turn admits steering only into the exact active turn', async () => {
  vi.useFakeTimers()
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  try {
    f.observe('UserPromptSubmit', Date.now())
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'steer',
      timeoutMs: 15000,
      whenBusy: 'steer',
      deliveryId: 'expected',
      expectTurnId: 'turn',
    })
    await vi.advanceTimersByTimeAsync(300)
    await expect(p).resolves.toMatchObject({ mode: 'steer', turnId: 'turn' })
  } finally {
    f.dispose()
  }
})
