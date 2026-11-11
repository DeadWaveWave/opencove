import { AsyncLocalStorage } from 'node:async_hooks'

/** In-process observation only; never serialized to the PTY host or the wire. */
export interface PhysicalSpawnObserver {
  readonly singleAttempt?: boolean
  beginSpawn?(): void
  beforeDispatch(execution?: { cwd: string }): void
  started(sessionId: string): void
  completed(sessionId: string): void
  /** No ID was returned; host completion is the authoritative resolution event. */
  unknown(completion: Promise<void>): void
}
export const physicalSpawnLifecycle = new AsyncLocalStorage<PhysicalSpawnObserver>()
