import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentPresentation } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import { getWorkspaceAgents } from '../utils/sidebarAgents'
import {
  advanceWaitingSince,
  type AgentWaitingSinceState,
  type ObservedAgentStatus,
} from '../utils/agentWaitingSince'

interface AgentWaitingSinceStore {
  /** Transient UI state, never persisted: when this window saw each agent start waiting. */
  observations: AgentWaitingSinceState
  observe: (
    agents: ReadonlyArray<{ nodeId: string; status: ObservedAgentStatus }>,
    nowMs: number,
  ) => void
}

export const useAgentWaitingSinceStore = create<AgentWaitingSinceStore>(set => ({
  observations: new Map(),
  observe: (agents, nowMs) =>
    set(state => {
      const observations = advanceWaitingSince(state.observations, agents, nowMs)
      return observations === state.observations ? state : { observations }
    }),
}))

/** Mounted once by the shell so waits are timed even while the sidebar is collapsed. */
export function useAgentWaitingSinceTracker(workspaces: readonly WorkspaceState[]): void {
  const observe = useAgentWaitingSinceStore(state => state.observe)
  useEffect(() => {
    observe(
      workspaces.flatMap(workspace =>
        getWorkspaceAgents(workspace).map(node => ({
          nodeId: node.id,
          status: resolveAgentPresentation(node.data).status,
        })),
      ),
      Date.now(),
    )
  }, [observe, workspaces])
}

/** Wall-clock time that advances only while a caller shows elapsed time. */
export function useMinuteClock(isEnabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!isEnabled) {
      return
    }
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [isEnabled])
  return nowMs
}
