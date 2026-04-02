import type { PersistedAppState } from '../../types'
import { DEFAULT_PERSIST_WRITE_DEBOUNCE_MS } from './constants'
import type { PersistWriteResult } from './types'
import { writePersistedState } from './write'

const SYNC_PERSIST_WRITE_DEBOUNCE_MS = 120

let scheduledPersistedStateProducer: (() => PersistedAppState) | null = null
let scheduledPersistedStateTimer: number | null = null
let scheduledPersistedStateOnResult: ((result: PersistWriteResult) => void) | null = null
let persistFlushInFlight = false
let persistFlushRequested = false
let flushPromise: Promise<void> | null = null
let flushPromiseResolve: (() => void) | null = null

function resolveFlushPromiseIfIdle(): void {
  if (!flushPromiseResolve) {
    return
  }

  if (persistFlushInFlight || persistFlushRequested) {
    return
  }

  if (scheduledPersistedStateProducer) {
    return
  }

  flushPromiseResolve()
  flushPromiseResolve = null
  flushPromise = null
}

function ensureFlushPromise(): Promise<void> {
  if (flushPromise) {
    return flushPromise
  }

  flushPromise = new Promise(resolve => {
    flushPromiseResolve = resolve
  })

  return flushPromise
}

function shouldUseSyncDebounce(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return typeof window.opencoveApi?.sync?.onStateUpdated === 'function'
}

function resolveDefaultPersistWriteDebounceMs(): number {
  return shouldUseSyncDebounce()
    ? SYNC_PERSIST_WRITE_DEBOUNCE_MS
    : DEFAULT_PERSIST_WRITE_DEBOUNCE_MS
}

export function schedulePersistedStateWrite(
  producer: () => PersistedAppState,
  options: { delayMs?: number; onResult?: (result: PersistWriteResult) => void } = {},
): void {
  if (typeof window === 'undefined') {
    return
  }

  scheduledPersistedStateProducer = producer
  scheduledPersistedStateOnResult = options.onResult ?? null

  if (scheduledPersistedStateTimer !== null) {
    return
  }

  const delayMs = options.delayMs ?? resolveDefaultPersistWriteDebounceMs()
  scheduledPersistedStateTimer = window.setTimeout(() => {
    scheduledPersistedStateTimer = null
    flushScheduledPersistedStateWrite()
  }, delayMs)
}

export function flushScheduledPersistedStateWrite(): void {
  if (typeof window !== 'undefined' && scheduledPersistedStateTimer !== null) {
    window.clearTimeout(scheduledPersistedStateTimer)
    scheduledPersistedStateTimer = null
  }

  if (persistFlushInFlight) {
    persistFlushRequested = true
    return
  }

  const producer = scheduledPersistedStateProducer
  const onResult = scheduledPersistedStateOnResult

  if (!producer) {
    resolveFlushPromiseIfIdle()
    return
  }

  scheduledPersistedStateProducer = null
  scheduledPersistedStateOnResult = null
  persistFlushInFlight = true

  void writePersistedState(producer())
    .then(result => {
      onResult?.(result)
    })
    .finally(() => {
      persistFlushInFlight = false

      if (!persistFlushRequested) {
        resolveFlushPromiseIfIdle()
        return
      }

      persistFlushRequested = false

      if (scheduledPersistedStateProducer) {
        flushScheduledPersistedStateWrite()
      } else {
        resolveFlushPromiseIfIdle()
      }
    })
}

export async function flushScheduledPersistedStateWriteAsync(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  flushScheduledPersistedStateWrite()

  if (!persistFlushInFlight && !persistFlushRequested && !scheduledPersistedStateProducer) {
    return
  }

  await ensureFlushPromise()
}
