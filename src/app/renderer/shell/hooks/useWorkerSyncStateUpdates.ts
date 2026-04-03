import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type {
  PersistedAppState,
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
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
            const currentById = new Map(current.workspaces.map(ws => [ws.id, ws] as const))

            const nextWorkspaces = persisted.workspaces.map(workspace =>
              toShellWorkspaceStateForSync(workspace, currentById.get(workspace.id)),
            )

            useAppStore.getState().setWorkspaces(nextWorkspaces)
            useAppStore
              .getState()
              .setActiveWorkspaceId(
                resolveNextActiveWorkspaceId(persisted, current.activeWorkspaceId),
              )
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
