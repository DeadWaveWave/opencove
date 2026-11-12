import { persistenceScope } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import {
  reportWorkerConnectionFailure,
  WORKER_CONNECTION_RETRY_EVENT,
} from './workerConnectionState'

/** Serialize startup retries and dispose every timer/listener with the hydration scope. */
export function startWorkerHydration(
  hydrate: () => Promise<void>,
  isCurrent: () => boolean,
): () => void {
  let active = true,
    inFlight = false,
    completed = false,
    pending = false,
    failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const generation = persistenceScope()
  const run = () => {
    if (!active || completed || !isCurrent() || generation !== persistenceScope()) {
      return
    }
    if (inFlight) {
      pending = true
      return
    }
    clearTimeout(timer)
    inFlight = true
    void hydrate()
      .then(() => {
        completed = true
      })
      .catch(error => {
        if (!active || !isCurrent() || generation !== persistenceScope()) {
          return
        }
        reportWorkerConnectionFailure(error)
        if (++failures < 4) {
          timer = setTimeout(run, 500 * 2 ** failures)
        }
      })
      .finally(() => {
        inFlight = false
        if (pending) {
          pending = false
          run()
        }
      })
  }
  const retry = () => {
    failures = 0
    run()
  }
  window.addEventListener('online', retry)
  window.addEventListener('focus', retry)
  window.addEventListener(WORKER_CONNECTION_RETRY_EVENT, retry)
  const unsubscribe = window.opencoveApi?.sync?.onStateUpdated?.(retry)
  run()
  return () => {
    active = false
    clearTimeout(timer)
    unsubscribe?.()
    window.removeEventListener('online', retry)
    window.removeEventListener('focus', retry)
    window.removeEventListener(WORKER_CONNECTION_RETRY_EVENT, retry)
  }
}
