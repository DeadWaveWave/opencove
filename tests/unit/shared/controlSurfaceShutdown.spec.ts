import { describe, expect, it } from 'vitest'
import {
  CONTROL_SURFACE_REQUEST_DRAIN_TIMEOUT_MS,
  CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS,
  LOCAL_WORKER_STOP_TIMEOUT_MS,
} from '../../../src/shared/runtime/controlSurfaceShutdown'

describe('Control Surface shutdown budgets', () => {
  it('lets accepted-request drain finish before Worker and launcher escalation', () => {
    expect(CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS).toBeGreaterThan(
      CONTROL_SURFACE_REQUEST_DRAIN_TIMEOUT_MS,
    )
    expect(LOCAL_WORKER_STOP_TIMEOUT_MS).toBeGreaterThan(CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS)
  })
})
