import type { Terminal } from '@xterm/xterm'
import type { TerminalHydrationResult } from './hydrateFromSnapshot'
import {
  canWriteTerminalOutput,
  subscribeAcceptedTerminalGeometry,
  subscribeTerminalGeometryWriteGate,
} from './terminalGeometryCoordinator'

const QUIET_PERIOD_MS = 100

/** One hydration generation owns its attempt, settle wait and cancellation. */
export function createTerminalHydrationLifecycle({
  terminal,
  attempt,
  isDisposed,
}: {
  terminal: Terminal
  attempt: (retry: boolean) => Promise<TerminalHydrationResult>
  isDisposed: () => boolean
}): { start: () => void; dispose: () => void } {
  let running = false
  let retryRequested = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const dispose = () => {
    closed = true
    retryRequested = false
    clearTimer()
    unsubscribeAccepted()
    unsubscribeGate()
  }
  const inactive = () => closed || isDisposed()
  const schedule = (delay: number) => {
    if (inactive()) {
      dispose()
      return
    }
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      if (inactive()) {
        dispose()
        return
      }
      if (!retryRequested || running) {
        return
      }
      if (!canWriteTerminalOutput(terminal)) {
        schedule(QUIET_PERIOD_MS)
        return
      }
      void run(true)
    }, delay)
  }
  const run = async (retry: boolean) => {
    if (inactive()) {
      dispose()
      return
    }
    if (running) {
      return
    }
    running = true
    retryRequested = false
    clearTimer()
    try {
      const result = await attempt(retry)
      if (inactive()) {
        dispose()
        return
      }
      if (result === 'retryable') {
        retryRequested = true
      } else {
        dispose()
      }
    } finally {
      running = false
      if (retryRequested && !inactive()) {
        schedule(QUIET_PERIOD_MS)
      }
    }
  }
  const geometrySettled = () => {
    if (retryRequested && !running && canWriteTerminalOutput(terminal)) {
      schedule(0)
    }
  }
  const unsubscribeAccepted = subscribeAcceptedTerminalGeometry(terminal, geometrySettled)
  const unsubscribeGate = subscribeTerminalGeometryWriteGate(terminal, geometrySettled)
  return {
    start: () => {
      void run(false)
    },
    dispose,
  }
}
