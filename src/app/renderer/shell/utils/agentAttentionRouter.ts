/**
 * Routes "an Agent needs you" to its three channels: the in-app card, the system notification
 * and the one sound. The switches decide here; main decides the foreground and drops a system
 * notification while any OpenCove window is focused (`systemNotifications.ts`).
 * See docs/agent/ATTENTION.md.
 */
export type AgentAttentionChannels = { inApp: boolean; system: boolean; sound: boolean }

export type AgentAttentionEffect<T> =
  | { kind: 'show-card'; item: T }
  | { kind: 'clear-card'; sessionId: string }
  | { kind: 'play-sound' }
  | { kind: 'system'; id: string; items: T[]; replacesId: string | null }

/** Agents that need you within this window share one sound and one system notification. */
export const AGENT_ATTENTION_COALESCE_MS = 1_500
/** Work shorter than this between two waits is jitter: the second wait is not announced. */
export const AGENT_ATTENTION_REWORK_DEBOUNCE_MS = 800

export interface AgentAttentionRouter<T> {
  needsYou: (item: T) => void
  working: (sessionId: string) => void
  dispose: () => void
}

type Batch<T> = {
  items: T[]
  systemId: string | null
  timer: ReturnType<typeof setTimeout>
}

export function createAgentAttentionRouter<T extends { sessionId: string }>({
  channels,
  emit,
  createId = () => crypto.randomUUID(),
}: {
  channels: () => AgentAttentionChannels
  emit: (effect: AgentAttentionEffect<T>) => void
  createId?: () => string
}): AgentAttentionRouter<T> {
  // Announced and still waiting, including Agents inside their rework debounce.
  const waiting = new Map<string, T>()
  const reworkTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let batch: Batch<T> | null = null

  const closeBatch = (): void => {
    const closing = batch
    batch = null
    if (!closing || closing.items.length < 2 || !channels().system) {
      return
    }

    const stillWaiting = closing.items.filter(item => waiting.has(item.sessionId))
    if (stillWaiting.length === 0) {
      return
    }
    emit({ kind: 'system', id: createId(), items: stillWaiting, replacesId: closing.systemId })
  }

  return {
    needsYou: item => {
      const rework = reworkTimers.get(item.sessionId)
      if (rework !== undefined) {
        clearTimeout(rework)
        reworkTimers.delete(item.sessionId)
        return
      }
      if (waiting.has(item.sessionId)) {
        return
      }

      waiting.set(item.sessionId, item)
      const open = channels()
      if (open.inApp) {
        emit({ kind: 'show-card', item })
      }
      if (batch) {
        batch.items.push(item)
        return
      }

      if (open.sound) {
        emit({ kind: 'play-sound' })
      }
      const systemId = open.system ? createId() : null
      if (systemId) {
        emit({ kind: 'system', id: systemId, items: [item], replacesId: null })
      }
      batch = {
        items: [item],
        systemId,
        timer: setTimeout(closeBatch, AGENT_ATTENTION_COALESCE_MS),
      }
    },

    working: sessionId => {
      if (!waiting.has(sessionId) || reworkTimers.has(sessionId)) {
        return
      }

      reworkTimers.set(
        sessionId,
        setTimeout(() => {
          reworkTimers.delete(sessionId)
          waiting.delete(sessionId)
          emit({ kind: 'clear-card', sessionId })
        }, AGENT_ATTENTION_REWORK_DEBOUNCE_MS),
      )
    },

    dispose: () => {
      if (batch) {
        clearTimeout(batch.timer)
        batch = null
      }
      reworkTimers.forEach(timer => clearTimeout(timer))
      reworkTimers.clear()
      waiting.clear()
    },
  }
}
