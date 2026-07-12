import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { waitForAgentStandbyNotificationTitle } from '../utils/agentStandbyNotificationTitleGate'
import {
  type AgentStandbyNotificationPayload,
  resolveAgentNodeForSessionId,
} from './useAgentStandbyNotificationWatcher'

export function useAgentStandbyNotificationTitleGate({
  enabled,
  onReady,
}: {
  enabled: boolean
  onReady: (payload: AgentStandbyNotificationPayload) => void
}): {
  deferUntilTitleReady: (payload: AgentStandbyNotificationPayload) => void
  cancelPendingTitle: (sessionId: string) => void
} {
  const pendingBySessionIdRef = useRef<Map<string, AbortController>>(new Map())
  const readyHandlerRef = useRef(onReady)

  useEffect(() => {
    readyHandlerRef.current = onReady
  }, [onReady])

  const deferUntilTitleReady = useCallback(
    (payload: AgentStandbyNotificationPayload) => {
      if (!enabled) {
        return
      }

      if (!payload.awaitingSessionTitle) {
        readyHandlerRef.current(payload)
        return
      }

      if (pendingBySessionIdRef.current.has(payload.sessionId)) {
        return
      }

      const abortController = new AbortController()
      pendingBySessionIdRef.current.set(payload.sessionId, abortController)

      void waitForAgentStandbyNotificationTitle({
        initial: payload,
        resolveLatest: () => resolveAgentNodeForSessionId(payload.sessionId),
        subscribe: listener => useAppStore.subscribe(listener),
        signal: abortController.signal,
      }).then(latest => {
        if (pendingBySessionIdRef.current.get(payload.sessionId) !== abortController) {
          return
        }

        pendingBySessionIdRef.current.delete(payload.sessionId)
        if (latest) {
          readyHandlerRef.current(latest)
        }
      })
    },
    [enabled],
  )

  const cancelPendingTitle = useCallback((sessionId: string) => {
    pendingBySessionIdRef.current.get(sessionId)?.abort()
    pendingBySessionIdRef.current.delete(sessionId)
  }, [])

  useEffect(() => {
    const pending = pendingBySessionIdRef.current
    return () => {
      pending.forEach(abortController => abortController.abort())
      pending.clear()
    }
  }, [])

  return { deferUntilTitleReady, cancelPendingTitle }
}
