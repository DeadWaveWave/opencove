import type { PersistWriteResult } from './types'
import { createAppErrorDescriptor } from '@shared/errors/appError'
import { getPersistencePort } from './port'
import { normalizeScrollback } from './normalize'

type PendingScrollbackWrite = {
  scrollback: string | null
  timer: number | null
  inFlight: boolean
  flushRequested: boolean
  onResult: ((result: PersistWriteResult) => void) | null
}

const pendingByNodeId = new Map<string, PendingScrollbackWrite>()

export function scheduleNodeScrollbackWrite(
  nodeId: string,
  scrollback: string | null,
  options: { delayMs?: number; onResult?: (result: PersistWriteResult) => void } = {},
): void {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedNodeId = nodeId.trim()
  if (normalizedNodeId.length === 0) {
    return
  }

  const normalizedScrollback = normalizeScrollback(scrollback)

  const existing = pendingByNodeId.get(normalizedNodeId)
  const pending: PendingScrollbackWrite =
    existing ??
    ({
      scrollback: null,
      timer: null,
      inFlight: false,
      flushRequested: false,
      onResult: null,
    } satisfies PendingScrollbackWrite)

  pending.scrollback = normalizedScrollback
  pending.onResult = options.onResult ?? pending.onResult
  pendingByNodeId.set(normalizedNodeId, pending)

  if (pending.timer !== null) {
    return
  }

  const delayMs = options.delayMs ?? 0
  pending.timer = window.setTimeout(() => {
    pending.timer = null
    flushNodeScrollbackWrite(normalizedNodeId)
  }, delayMs)
}

export function clearNodeScrollbackWrite(
  nodeId: string,
  options: { onResult?: (result: PersistWriteResult) => void } = {},
): void {
  scheduleNodeScrollbackWrite(nodeId, null, { delayMs: 0, onResult: options.onResult })
}

export function flushScheduledNodeScrollbackWrites(): void {
  for (const nodeId of pendingByNodeId.keys()) {
    flushNodeScrollbackWrite(nodeId)
  }
}

function flushNodeScrollbackWrite(nodeId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const pending = pendingByNodeId.get(nodeId)
  if (!pending) {
    return
  }

  if (pending.timer !== null) {
    window.clearTimeout(pending.timer)
    pending.timer = null
  }

  if (pending.inFlight) {
    pending.flushRequested = true
    return
  }

  pending.inFlight = true
  const scrollback = pending.scrollback
  const onResult = pending.onResult

  const port = getPersistencePort()

  void (
    port
      ? port.writeNodeScrollback(nodeId, scrollback)
      : Promise.resolve<PersistWriteResult>({
          ok: false,
          reason: 'unavailable',
          error: createAppErrorDescriptor('persistence.unavailable'),
        })
  )
    .then(result => {
      onResult?.(result)
    })
    .finally(() => {
      pending.inFlight = false

      const nextPending = pendingByNodeId.get(nodeId)
      if (!nextPending) {
        return
      }

      const shouldFlushAgain = nextPending.flushRequested || nextPending.scrollback !== scrollback

      nextPending.flushRequested = false

      if (shouldFlushAgain) {
        flushNodeScrollbackWrite(nodeId)
        return
      }

      if (
        nextPending.timer === null &&
        nextPending.inFlight === false &&
        nextPending.flushRequested === false
      ) {
        pendingByNodeId.delete(nodeId)
      }
    })
}
