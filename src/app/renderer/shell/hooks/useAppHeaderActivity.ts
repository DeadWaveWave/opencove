import { useMemo } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useViewportSpaceStore } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/viewportSpace'
import { summarizeAgentActivity, type AgentActivitySummary } from '../utils/agentActivitySummary'

/** What the top bar shows: the viewport's Space and agent activity across every project. */
export function useAppHeaderActivity(
  workspaces: readonly WorkspaceState[],
  activeWorkspace: WorkspaceState | null,
): { activeSpaceName: string | null; agentActivity: AgentActivitySummary } {
  const viewportSpaceId = useViewportSpaceStore(state =>
    activeWorkspace ? (state.spaceIdByWorkspace[activeWorkspace.id] ?? null) : null,
  )
  const activeSpaceName =
    activeWorkspace?.spaces.find(space => space.id === viewportSpaceId)?.name ?? null
  const agentActivity = useMemo(() => summarizeAgentActivity(workspaces), [workspaces])
  return { activeSpaceName, agentActivity }
}
