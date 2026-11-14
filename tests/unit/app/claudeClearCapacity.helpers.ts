import { vi } from 'vitest'
import {
  PromptDeliveryService,
  type PromptDeliveryRequest,
} from '../../../src/contexts/agent/application/PromptDeliveryService'
import type { clearIngressFixture } from './claudeClearIngress.helpers'
export async function capacityAttempt(
  f: Awaited<ReturnType<typeof clearIngressFixture>>,
  overrides: Partial<Pick<PromptDeliveryRequest, 'whenBusy' | 'expectTurnId'>> = {},
) {
  const service = new PromptDeliveryService({
    runs: f.registry,
    input: f.hub,
    now: Date.now,
    createDeliveryId: () => 'capacity',
    capability: () => ({ supported: true, submitDelayMs: 300 }),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
  })
  const before = f.write.mock.calls.length
  const pending = service
    .deliver({
      nodeId: 'n',
      text: 'MUST_NOT_WRITE',
      whenBusy: 'refuse',
      timeoutMs: 1000,
      ...overrides,
    })
    .catch(error => error)
  await vi.advanceTimersByTimeAsync(301)
  service.dispose()
  const result = await pending
  return { writes: f.write.mock.calls.length - before, result }
}

export async function capacityWrites(f: Awaited<ReturnType<typeof clearIngressFixture>>) {
  return (await capacityAttempt(f)).writes
}
