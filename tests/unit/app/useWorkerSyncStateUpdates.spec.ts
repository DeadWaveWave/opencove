import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  resolveWorkspacesForWorkerSync,
  shouldApplyWorkerSyncRefresh,
} from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'

function createWorkspace(id: string, overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    ...overrides,
  }
}

describe('useWorkerSyncStateUpdates helpers', () => {
  it('skips worker sync refresh when persisted state only echoes the current durable state', () => {
    const workspace = createWorkspace('workspace-1')
    const currentState = {
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      agentSettings: DEFAULT_AGENT_SETTINGS,
    }
    const persistedState = toPersistedState(
      currentState.workspaces,
      currentState.activeWorkspaceId,
      currentState.agentSettings,
    )

    expect(
      shouldApplyWorkerSyncRefresh({
        currentState,
        persistedState,
      }),
    ).toBe(false)
  })

  it('preserves unchanged workspace references when syncing a different workspace', () => {
    const activeWorkspace = createWorkspace('workspace-1')
    const backgroundWorkspace = createWorkspace('workspace-2')
    const currentWorkspaces = [activeWorkspace, backgroundWorkspace]

    const persistedState = toPersistedState(
      [
        activeWorkspace,
        createWorkspace('workspace-2', {
          name: 'workspace-2-updated',
        }),
      ],
      activeWorkspace.id,
      DEFAULT_AGENT_SETTINGS,
    )

    const nextWorkspaces = resolveWorkspacesForWorkerSync({
      currentWorkspaces,
      persistedWorkspaces: persistedState.workspaces,
    })

    expect(nextWorkspaces).not.toBe(currentWorkspaces)
    expect(nextWorkspaces[0]).toBe(activeWorkspace)
    expect(nextWorkspaces[1]).not.toBe(backgroundWorkspace)
    expect(nextWorkspaces[1]?.name).toBe('workspace-2-updated')
  })
})
