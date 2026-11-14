import { replaceFromSync } from '@contexts/workspace/presentation/renderer'
import { useAppStore, type AppStoreState } from '../../store/useAppStore'

type SyncedState = Pick<AppStoreState, 'workspaces' | 'activeWorkspaceId' | 'agentSettings'>

/**
 * Two writes in one synchronous block: the document module owns workspaces, the store owns
 * settings. No store listener reads both fields, and React renders once after the block.
 */
export function applyWorkerSyncState(
  next: Pick<SyncedState, 'workspaces' | 'activeWorkspaceId'> & {
    settings: SyncedState['agentSettings'] | null
  },
): void {
  replaceFromSync({ workspaces: next.workspaces, activeWorkspaceId: next.activeWorkspaceId })
  if (next.settings) {
    useAppStore.getState().setAgentSettings(next.settings)
  }
}
