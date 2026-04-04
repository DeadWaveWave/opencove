import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  PersistedAppState,
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { sanitizeWorkspaceSpaces } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { readPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { useAppStore } from '../store/useAppStore'
import type { SyncEventPayload } from '@shared/contracts/dto'

function mergeRuntimeNode(
  persistedNode: Node<TerminalNodeData>,
  existingNode: Node<TerminalNodeData> | undefined,
): Node<TerminalNodeData> {
  if (!existingNode) {
    return persistedNode
  }

  return {
    ...persistedNode,
    data: {
      ...persistedNode.data,
      sessionId: existingNode.data.sessionId || '',
      scrollback: existingNode.data.scrollback ?? persistedNode.data.scrollback,
    },
  }
}

function toShellWorkspaceStateForSync(
  workspace: PersistedWorkspaceState,
  existingWorkspace: WorkspaceState | undefined,
): WorkspaceState {
  const persistedNodes = toRuntimeNodes(workspace)
  const existingNodeById = new Map(
    (existingWorkspace?.nodes ?? []).map(node => [node.id, node] as const),
  )
  const persistedNodeIds = new Set(persistedNodes.map(node => node.id))

  const mergedPersistedNodes = persistedNodes.map(node =>
    mergeRuntimeNode(node, existingNodeById.get(node.id)),
  )

  const extraRuntimeNodes = (existingWorkspace?.nodes ?? []).filter(
    node => !persistedNodeIds.has(node.id),
  )

  const nodes = [...mergedPersistedNodes, ...extraRuntimeNodes]
  const validNodeIds = new Set(nodes.map(node => node.id))

  const existingSpaceById = new Map(
    (existingWorkspace?.spaces ?? []).map(space => [space.id, space] as const),
  )

  const sanitizedSpaces = sanitizeWorkspaceSpaces(
    workspace.spaces.map(space => {
      const existing = existingSpaceById.get(space.id) ?? null
      const extraNodeIds = existing
        ? existing.nodeIds.filter(nodeId => !space.nodeIds.includes(nodeId))
        : []

      return {
        ...space,
        nodeIds: [...space.nodeIds, ...extraNodeIds].filter(nodeId => validNodeIds.has(nodeId)),
      }
    }),
  )

  const hasActiveSpace =
    workspace.activeSpaceId !== null &&
    sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    worktreesRoot: workspace.worktreesRoot,
    pullRequestBaseBranchOptions: workspace.pullRequestBaseBranchOptions ?? [],
    nodes,
    viewport: existingWorkspace?.viewport ?? {
      x: workspace.viewport.x,
      y: workspace.viewport.y,
      zoom: workspace.viewport.zoom,
    },
    isMinimapVisible: workspace.isMinimapVisible,
    spaces: sanitizedSpaces,
    activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
    spaceArchiveRecords: workspace.spaceArchiveRecords,
  }
}

function resolveNextActiveWorkspaceId(
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
    buildPersistedStateSignature(currentPersistedState) !==
    buildPersistedStateSignature(persistedState)
  )
}

export function resolveWorkspacesForWorkerSync({
  currentWorkspaces,
  persistedWorkspaces,
}: {
  currentWorkspaces: WorkspaceState[]
  persistedWorkspaces: PersistedWorkspaceState[]
}): WorkspaceState[] {
  const currentById = new Map(
    currentWorkspaces.map(workspace => [workspace.id, workspace] as const),
  )

  const nextWorkspaces = persistedWorkspaces.map(workspace => {
    const existingWorkspace = currentById.get(workspace.id)
    if (!existingWorkspace) {
      return toShellWorkspaceStateForSync(workspace, undefined)
    }

    return buildCurrentWorkspacePersistedSignature(existingWorkspace) ===
      buildPersistedWorkspaceSignature(workspace)
      ? existingWorkspace
      : toShellWorkspaceStateForSync(workspace, existingWorkspace)
  })

  if (nextWorkspaces.length !== currentWorkspaces.length) {
    return nextWorkspaces
  }

  return nextWorkspaces.every((workspace, index) => workspace === currentWorkspaces[index])
    ? currentWorkspaces
    : nextWorkspaces
}

export function useWorkerSyncStateUpdates(options: { enabled: boolean }): void {
  const refreshTimerRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)

  useEffect(() => {
    if (!options.enabled) {
      return
    }

    const scheduleRefresh = (): void => {
      if (refreshInFlightRef.current) {
        return
      }

      if (refreshTimerRef.current !== null) {
        return
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        refreshInFlightRef.current = true

        void readPersistedState()
          .then(persisted => {
            if (!persisted) {
              return
            }

            const current = useAppStore.getState()
            if (
              !shouldApplyWorkerSyncRefresh({
                currentState: current,
                persistedState: persisted,
              })
            ) {
              return
            }

            const nextWorkspaces = resolveWorkspacesForWorkerSync({
              currentWorkspaces: current.workspaces,
              persistedWorkspaces: persisted.workspaces,
            })
            const nextActiveWorkspaceId = resolveNextActiveWorkspaceId(
              persisted,
              current.activeWorkspaceId,
            )

            if (nextWorkspaces !== current.workspaces) {
              useAppStore.getState().setWorkspaces(nextWorkspaces)
            }

            if (nextActiveWorkspaceId !== current.activeWorkspaceId) {
              useAppStore.getState().setActiveWorkspaceId(nextActiveWorkspaceId)
            }
          })
          .finally(() => {
            refreshInFlightRef.current = false
          })
      }, 150)
    }

    const syncApi = window.opencoveApi?.sync
    const unsubscribe =
      typeof syncApi?.onStateUpdated === 'function'
        ? syncApi.onStateUpdated((_event: SyncEventPayload) => {
            scheduleRefresh()
          })
        : null

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      refreshInFlightRef.current = false
      unsubscribe?.()
    }
  }, [options.enabled])
}
