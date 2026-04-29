import type { PersistWriteResult } from './types'
import { createAppErrorDescriptor } from '@shared/errors/appError'
import { getPersistencePort } from './port'
import { normalizeScrollback } from './normalize'

type ScrollbackWriteTarget = 'terminal' | 'agent-placeholder'

type PendingScrollbackWrite = {
  target: ScrollbackWriteTarget
  scrollback: string | null
  timer: number | null
  inFlight: boolean
  flushRequested: boolean
  onResult: ((result: PersistWriteResult) => void) | null
}

const pendingByKey = new Map<string, PendingScrollbackWrite>()

function resolvePendingKey(target: ScrollbackWriteTarget, nodeId: string): string {
  return `${target}:${nodeId}`
}

function resolvePersistWrite(
  target: ScrollbackWriteTarget,
  nodeId: string,
  scrollback: string | null,
): Promise<PersistWriteResult> {
  const port = getPersistencePort()

  if (!port) {
    return Promise.resolve({
      ok: false,
      reason: 'unavailable',
      error: createAppErrorDescriptor('persistence.unavailable'),
    })
  }

  return target === 'terminal'
    ? port.writeNodeScrollback(nodeId, scrollback)
    : port.writeAgentNodePlaceholderScrollback(nodeId, scrollback)
}

function scheduleScrollbackWrite(
  target: ScrollbackWriteTarget,
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
  const pendingKey = resolvePendingKey(target, normalizedNodeId)

  const existing = pendingByKey.get(pendingKey)
  const pending: PendingScrollbackWrite =
    existing ??
    ({
      target,
      scrollback: null,
      timer: null,
      inFlight: false,
      flushRequested: false,
      onResult: null,
    } satisfies PendingScrollbackWrite)

  pending.scrollback = normalizedScrollback
  pending.onResult = options.onResult ?? pending.onResult
  pendingByKey.set(pendingKey, pending)

  if (pending.timer !== null) {
    return
  }

  const delayMs = options.delayMs ?? 0
  if (delayMs <= 0) {
    flushScrollbackWrite(target, normalizedNodeId)
    return
  }

  pending.timer = window.setTimeout(() => {
    pending.timer = null
    flushScrollbackWrite(target, normalizedNodeId)
  }, delayMs)
}

export function scheduleNodeScrollbackWrite(
  nodeId: string,
  scrollback: string | null,
  options: { delayMs?: number; onResult?: (result: PersistWriteResult) => void } = {},
): void {
  scheduleScrollbackWrite('terminal', nodeId, scrollback, options)
}

export function scheduleAgentPlaceholderScrollbackWrite(
  nodeId: string,
  scrollback: string | null,
  options: { delayMs?: number; onResult?: (result: PersistWriteResult) => void } = {},
): void {
  scheduleScrollbackWrite('agent-placeholder', nodeId, scrollback, options)
}

export function clearScheduledScrollbackWrites(
  nodeId: string,
  options: { onResult?: (result: PersistWriteResult) => void } = {},
): void {
  scheduleNodeScrollbackWrite(nodeId, null, { delayMs: 0, onResult: options.onResult })
  scheduleAgentPlaceholderScrollbackWrite(nodeId, null, {
    delayMs: 0,
    onResult: options.onResult,
  })
}

export function flushScheduledScrollbackWrites(): void {
  for (const [pendingKey, pending] of pendingByKey.entries()) {
    const targetPrefix = `${pending.target}:`
    const nodeId = pendingKey.startsWith(targetPrefix)
      ? pendingKey.slice(targetPrefix.length)
      : pendingKey
    flushScrollbackWrite(pending.target, nodeId)
  }
}

function flushScrollbackWrite(target: ScrollbackWriteTarget, nodeId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const pendingKey = resolvePendingKey(target, nodeId)
  const pending = pendingByKey.get(pendingKey)
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

  void resolvePersistWrite(target, nodeId, scrollback)
    .then(result => {
      onResult?.(result)
    })
    .finally(() => {
      pending.inFlight = false

      const nextPending = pendingByKey.get(pendingKey)
      if (!nextPending) {
        return
      }

      const shouldFlushAgain = nextPending.flushRequested || nextPending.scrollback !== scrollback

      nextPending.flushRequested = false

      if (shouldFlushAgain) {
        flushScrollbackWrite(target, nodeId)
        return
      }

      if (
        nextPending.timer === null &&
        nextPending.inFlight === false &&
        nextPending.flushRequested === false
      ) {
        pendingByKey.delete(pendingKey)
      }
    })
}
