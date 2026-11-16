import { expect, it } from 'vitest'
import {
  DEFAULT_LEASE_TIMEOUT_MS,
  WORKER_LEASE_RELEASE_TIMEOUT_MS,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import { LOCAL_WORKER_READY_TIMEOUT_MS } from '../../../src/app/main/worker/localWorkerReadyTimeout'

it('11 keeps the lease deadline, the Worker release and Worker boot inside the ready timeout', () => {
  // A Worker that legitimately waits for the lease, and then releases it before it prints its ready
  // line, must not be killed by main's ready timer.
  expect(DEFAULT_LEASE_TIMEOUT_MS + WORKER_LEASE_RELEASE_TIMEOUT_MS + 2_000).toBeLessThanOrEqual(
    LOCAL_WORKER_READY_TIMEOUT_MS,
  )
})
