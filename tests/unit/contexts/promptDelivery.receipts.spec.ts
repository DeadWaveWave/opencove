import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => {
  vi.useRealTimers()
})
it('runtime ingress rejects late pre-Enter emission and missing provenance despite fresh local sequences', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture()
  try {
    const result = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    vi.setSystemTime(1400)
    f.observe('UserPromptSubmit', 1100) // Assigned a fresh sequence by real runtime ingress.
    let done = false
    void result.then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    f.observe('UserPromptSubmit')
    await Promise.resolve()
    expect(done).toBe(false)
    f.observe('UserPromptSubmit', 1300)
    await expect(result).resolves.toMatchObject({ phase: 'submission_observed' })
  } finally {
    f.dispose()
  }
})
it.each(['overall', 'receipt', 'caller'] as const)(
  'rejects %s overdue receipts before the overdue timer callback runs',
  async kind => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const scheduled: { cb: () => void; delay: number }[] = []
    const f = promptDeliveryRuntimeFixture((cb, delay) => {
      const task = { cb, delay }
      scheduled.push(task)
      return () => {
        const index = scheduled.indexOf(task)
        if (index >= 0) {
          scheduled.splice(index, 1)
        }
      }
    })
    let live = true
    try {
      const result = f.deliver(
        {
          assertActive: () => {
            if (!live) {
              throw new Error('revoked')
            }
          },
        },
        kind === 'overall' ? 1000 : 15000,
      )
      await Promise.resolve() // Acquire real Hub queue.
      const submitDelay = scheduled.find(task => task.delay === 300)!
      expect(submitDelay).toBeDefined()
      vi.setSystemTime(1300)
      submitDelay.cb()
      await Promise.resolve()
      await Promise.resolve()
      expect(f.write).toHaveBeenCalledTimes(2)
      vi.setSystemTime(kind === 'overall' ? 2101 : kind === 'receipt' ? 6301 : 1400)
      if (kind === 'caller') {
        live = false
      }
      const assertion = expect(result).rejects.toMatchObject({
        code: 'agent.prompt_stalled',
        details: {
          reason:
            kind === 'overall'
              ? 'deadline'
              : kind === 'receipt'
                ? 'receipt_deadline'
                : 'caller_revoked',
          pasteDispatchAttempted: true,
          submitDispatchAttempted: true,
        },
      })
      f.observe('UserPromptSubmit', Date.now())
      await assertion
    } finally {
      f.dispose()
    }
  },
)
