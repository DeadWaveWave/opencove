import type { AgentStandbyNotificationPayload } from '../hooks/useAgentStandbyNotificationWatcher'

export const AGENT_STANDBY_TITLE_WAIT_TIMEOUT_MS = 1_000

export async function waitForAgentStandbyNotificationTitle({
  initial,
  resolveLatest,
  subscribe,
  signal,
  timeoutMs = AGENT_STANDBY_TITLE_WAIT_TIMEOUT_MS,
}: {
  initial: AgentStandbyNotificationPayload
  resolveLatest: () => AgentStandbyNotificationPayload | null
  subscribe: (listener: () => void) => () => void
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<AgentStandbyNotificationPayload | null> {
  if (signal?.aborted) {
    return null
  }

  if (!initial.awaitingSessionTitle) {
    return initial
  }

  return await new Promise(resolve => {
    let settled = false
    let timeoutId: number | null = null
    let unsubscribe: (() => void) | null = null

    const finish = (payload: AgentStandbyNotificationPayload | null): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      unsubscribe?.()
      signal?.removeEventListener('abort', handleAbort)
      resolve(payload)
    }

    const handleAbort = (): void => {
      finish(null)
    }

    const resolveIfReady = (): void => {
      const latest = resolveLatest()
      if (!latest || !latest.awaitingSessionTitle || latest.title !== initial.title) {
        finish(latest)
      }
    }

    unsubscribe = subscribe(resolveIfReady)
    signal?.addEventListener('abort', handleAbort, { once: true })
    timeoutId = window.setTimeout(
      () => {
        finish(resolveLatest())
      },
      Math.max(0, timeoutMs),
    )
    resolveIfReady()
  })
}
