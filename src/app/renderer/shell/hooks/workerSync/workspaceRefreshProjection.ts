import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  PersistedAppState,
  PersistedWorkspaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  getSyncedPersistedState,
  reconcileCanonicalPublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { hasRuntimeBindingPublication } from './runtimeSessionBinding'
import { toShellWorkspaceStateForSync } from './mergeWorkspaceStateForSync'

export function resolveNextActiveWorkspaceId(
  state: PersistedAppState,
  currentActive: string | null,
): string | null {
  const ids = state.workspaces.map(workspace => workspace.id)
  if (currentActive && ids.includes(currentActive)) {
    return currentActive
  }

  if (state.activeWorkspaceId && ids.includes(state.activeWorkspaceId)) {
    return state.activeWorkspaceId
  }

  return ids[0] ?? null
}

function buildPersistedStateSignature(state: PersistedAppState): string {
  return JSON.stringify(state)
}

function buildPersistedWorkspaceSignature(state: PersistedWorkspaceState): string {
  return JSON.stringify(state)
}

function buildCurrentWorkspacePersistedSignature(workspace: WorkspaceState): string {
  const persistedWorkspace = toPersistedState([workspace], workspace.id).workspaces[0]
  return JSON.stringify(persistedWorkspace)
}

export function shouldApplyWorkerSyncRefresh({
  currentState,
  persistedState,
}: {
  currentState: {
    workspaces: WorkspaceState[]
    activeWorkspaceId: string | null
    agentSettings: AgentSettings
  }
  persistedState: PersistedAppState
}): boolean {
  const currentPersistedState = toPersistedState(
    currentState.workspaces,
    currentState.activeWorkspaceId,
    currentState.agentSettings,
  )

  return (
    hasRuntimeBindingPublication(currentState.workspaces) ||
    buildPersistedStateSignature(currentPersistedState) !==
      buildPersistedStateSignature(persistedState)
  )
}

export function resolveWorkspacesForWorkerSync({
  currentWorkspaces,
  persistedWorkspaces,
  baseState = getSyncedPersistedState(),
}: {
  currentWorkspaces: WorkspaceState[]
  persistedWorkspaces: PersistedWorkspaceState[]
  baseState?: PersistedAppState | null
}): WorkspaceState[] {
  const currentById = new Map(
    currentWorkspaces.map(workspace => [workspace.id, workspace] as const),
  )

  const nextWorkspaces = persistedWorkspaces.map(workspace => {
    const existingWorkspace = currentById.get(workspace.id)
    if (!existingWorkspace) {
      return toShellWorkspaceStateForSync(workspace, undefined)
    }

    return !hasRuntimeBindingPublication([existingWorkspace]) &&
      buildCurrentWorkspacePersistedSignature(existingWorkspace) ===
        buildPersistedWorkspaceSignature(workspace)
      ? existingWorkspace
      : toShellWorkspaceStateForSync(
          workspace,
          existingWorkspace,
          baseState?.workspaces.find(base => base.id === workspace.id),
        )
  })

  if (nextWorkspaces.length !== currentWorkspaces.length) {
    return nextWorkspaces
  }

  return nextWorkspaces.every((workspace, index) => workspace === currentWorkspaces[index])
    ? currentWorkspaces
    : nextWorkspaces
}

/** Connect reconciliation rebases workspace/settings intent; node and membership guards
 * remain owned by the normal sync projection, rather than merging their deltas twice. */
export function rebaseConnectMetadata(
  canonical: PersistedAppState,
  current: PersistedAppState,
): PersistedAppState {
  const rebased = reconcileCanonicalPublication(canonical, current)
  return {
    ...rebased,
    workspaces: rebased.workspaces.map(workspace => {
      const latest = canonical.workspaces.find(candidate => candidate.id === workspace.id)
      return latest
        ? {
            ...workspace,
            nodes: latest.nodes,
            spaces: workspace.spaces.map(space => ({
              ...space,
              nodeIds:
                latest.spaces.find(candidate => candidate.id === space.id)?.nodeIds ??
                space.nodeIds,
            })),
          }
        : workspace
    }),
  }
}
