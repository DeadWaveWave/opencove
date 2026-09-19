import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReadAgentLastMessageResult } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentTreatedActionContext } from '../../../utils/terminalAgentOverlay'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'

const ACTIVE_REFRESH_MS = 1800
const IDLE_REFRESH_MS = 5000

export function useCollapsedAgentMessage(data: TerminalNodeData, enabled: boolean): string {
  const action = resolveAgentTreatedActionContext({ data })
  const provider = action?.provider
  const cwd = action?.cwd
  const startedAt = action?.startedAt
  const resumeSessionId = action?.resumeSessionId ?? null
  const key = JSON.stringify([provider, cwd, startedAt, resumeSessionId, data.sessionId])
  const payload = useMemo(
    () => (provider && cwd && startedAt ? { provider, cwd, startedAt, resumeSessionId } : null),
    [provider, cwd, startedAt, resumeSessionId],
  )
  const [latest, setLatest] = useState<{ key: string; message: string } | null>(null)
  const inFlight = useRef<{ key: string; request: Promise<ReadAgentLastMessageResult> } | null>(
    null,
  )
  const interval =
    resolveAgentPresentation(data).status === 'running' ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS

  useEffect(() => {
    if (!enabled || !payload || !window.opencoveApi?.agent?.readLastMessage) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    // Scheduling after completion prevents overlapping disk/remote requests.
    const read = async () => {
      try {
        if (document.visibilityState !== 'hidden') {
          const pending =
            inFlight.current?.key === key
              ? inFlight.current
              : {
                  key,
                  request: window.opencoveApi.agent.readLastMessage(payload),
                }
          inFlight.current = pending
          let result: ReadAgentLastMessageResult
          try {
            result = await pending.request
          } finally {
            if (inFlight.current === pending) {
              inFlight.current = null
            }
          }
          const message = result.message?.trim() ?? ''
          if (!cancelled && message) {
            setLatest({ key, message })
          }
        }
      } catch {
        // A temporarily unavailable session keeps its last authoritative message.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => void read(), interval)
        }
      }
    }
    void read()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, interval, key, payload])

  return latest?.key === key ? latest.message : ''
}
