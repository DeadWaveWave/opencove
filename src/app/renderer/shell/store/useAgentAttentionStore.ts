import { useMemo } from 'react'
import { create } from 'zustand'
import { agentAttentionKey } from '../utils/sidebarAgents'
import type { AgentStandbyNotification } from '../utils/agentStandbyNotification'

/** Unanswered Agents kept at most; the oldest fall away first. */
export const AGENT_ATTENTION_MAX_PENDING = 20

type NotificationsUpdate =
  | AgentStandbyNotification[]
  | ((previous: AgentStandbyNotification[]) => AgentStandbyNotification[])

interface AgentAttentionStore {
  /**
   * Transient, never persisted: the Agents that ended a turn you have not answered, newest
   * first. The attention router adds them; they go when the Agent works again, when you close
   * its card, or when you jump to it from anywhere (docs/ui/AGENT_ISLAND.md).
   */
  notifications: AgentStandbyNotification[]
  setNotifications: (update: NotificationsUpdate) => void
  dismiss: (id: string) => void
  /** You went to the Agent: whatever it told you is answered. */
  acknowledgeNode: (workspaceId: string, nodeId: string) => void
}

export const useAgentAttentionStore = create<AgentAttentionStore>(set => ({
  notifications: [],
  setNotifications: update =>
    set(state => {
      const notifications = typeof update === 'function' ? update(state.notifications) : update
      return notifications === state.notifications ? state : { notifications }
    }),
  dismiss: id =>
    set(state =>
      state.notifications.some(item => item.id === id)
        ? { notifications: state.notifications.filter(item => item.id !== id) }
        : state,
    ),
  acknowledgeNode: (workspaceId, nodeId) =>
    set(state => {
      const matches = (item: AgentStandbyNotification) =>
        item.workspaceId === workspaceId && item.nodeId === nodeId
      return state.notifications.some(matches)
        ? { notifications: state.notifications.filter(item => !matches(item)) }
        : state
    }),
}))

/** The unanswered Agents for `summarizeAgentActivity`: since when each has waited. */
export function useAgentsNeedingYou(): ReadonlyMap<string, number> {
  const notifications = useAgentAttentionStore(state => state.notifications)
  return useMemo(() => {
    const needsYou = new Map<string, number>()
    // Newest first, so an Agent announced twice keeps its first wait.
    for (const item of notifications) {
      needsYou.set(agentAttentionKey(item.workspaceId, item.nodeId), item.createdAt)
    }
    return needsYou
  }, [notifications])
}
