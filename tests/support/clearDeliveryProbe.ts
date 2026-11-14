import { vi } from 'vitest'
import { PromptDeliveryService } from '../../src/contexts/agent/application/PromptDeliveryService'
import type { promptDeliveryRuntimeFixture } from './promptDeliveryRuntimeFixture'

/** A new delivery owner per probe prevents retained refusals from masking later admissions. */
export async function probeClearDelivery(
  f: Pick<ReturnType<typeof promptDeliveryRuntimeFixture>, 'registry' | 'hub' | 'write'>,
) {
  const service = new PromptDeliveryService({
    runs: f.registry,
    input: f.hub,
    now: Date.now,
    createDeliveryId: () => 'probe',
    capability: () => ({ supported: true, submitDelayMs: 300 }),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
  })
  const before = f.write.mock.calls.length
  const pending = service
    .deliver({ nodeId: 'n', text: 'probe', timeoutMs: 1000, whenBusy: 'steer' })
    .catch(error => error)
  await vi.advanceTimersByTimeAsync(0)
  const writes = f.write.mock.calls.length - before
  service.dispose()
  const result = await pending
  return { writes, result }
}
