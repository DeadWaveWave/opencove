// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'
it('cancels pending Enter on private saturation from an ignored receipt without publishing it', async () => {
  const f = await clearIngressFixture(false)
  const service = new PromptDeliveryService({
    runs: f.registry,
    input: f.hub,
    now: Date.now,
    createDeliveryId: () => 'saturation',
    capability: () => ({ supported: true, submitDelayMs: 300 }),
    schedule: (cb, ms) => {
      const timer = setTimeout(cb, ms)
      return () => clearTimeout(timer)
    },
  })
  try {
    await f.send('B', 'SessionStart', 20, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    await f.send('C', 'SessionStart', 100, undefined, 'clear')
    await vi.advanceTimersByTimeAsync(201)
    const seq = f.registry.list().seq
    for (let n = 0; n < 1022; n++) {
      // oxlint-disable-next-line no-await-in-loop -- fill provenance with authenticated rejected hooks
      await f.send('B', 'Stop', 1000 + n, `ignored-${n}`)
    }
    expect(f.fence().claudeHistorySaturated).not.toBe(true)
    const result = service
      .deliver({ nodeId: 'n', text: 'pending', timeoutMs: 1000, whenBusy: 'refuse' })
      .catch(error => error)
    for (let n = 0; n < 8; n++) {
      // oxlint-disable-next-line no-await-in-loop -- drain serial Hub acquisition without advancing Enter timer
      await Promise.resolve()
    }
    expect(f.write).toHaveBeenCalledTimes(1)
    await f.send('B', 'Stop', 2022, 'overflow')
    await vi.advanceTimersByTimeAsync(1001)
    expect(toAppErrorDescriptor(await result)).toMatchObject({
      details: {
        reason: 'history_saturated',
        pasteDispatchAttempted: true,
        submitDispatchAttempted: false,
      },
    })
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.registry.list().seq).toBe(seq)
  } finally {
    service.dispose()
    await f.close()
  }
})
