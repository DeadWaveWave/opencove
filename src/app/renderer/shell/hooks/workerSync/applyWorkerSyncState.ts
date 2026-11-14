import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { replaceFromSync } from '@contexts/workspace/presentation/renderer'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../../store/useAppStore'

/**
 * Two writes in one synchronous block: the document module owns workspaces, the store owns
 * settings. No store listener reads both fields, and React renders once after the block.
 */
export function applyWorkerSyncState(next: {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  settings: AgentSettings | null
}): void {
  replaceFromSync({ workspaces: next.workspaces, activeWorkspaceId: next.activeWorkspaceId })
  if (next.settings) {
    useAppStore.getState().setAgentSettings(next.settings)
  }
}
