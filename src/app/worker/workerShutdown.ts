import { CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS } from '../../shared/runtime/controlSurfaceShutdown'

/** Own request draining and lock release for every Worker shutdown source. */
export function createWorkerShutdown(dispose: () => Promise<void>, release: () => Promise<void>) {
  let shutdownRequested = false
  return async (code: number): Promise<void> => {
    if (shutdownRequested) {
      return
    }
    shutdownRequested = true
    const forceExitTimer = setTimeout(
      () => process.exit(code),
      CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS,
    )
    forceExitTimer.unref()
    try {
      await dispose()
    } catch {
      /* Preserve cleanup after a disposal failure. */
    }
    try {
      await release()
    } catch {
      /* Preserve the existing best-effort lock release. */
    } finally {
      clearTimeout(forceExitTimer)
    }
    process.exit(code)
  }
}
