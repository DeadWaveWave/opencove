import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type {
  PersistedAppState,
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { sanitizeWorkspaceSpaces } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { readPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { useAppStore } from '../store/useAppStore'
import type { SyncEventPayload } from '@shared/contracts/dto'

const LOCAL_SYNC_WRITE_EVENT_NAME = 'opencove.localSyncWrite'

function mergeRuntimeNode(
  persistedNode: Node<TerminalNodeData>,
  existingNode: Node<TerminalNodeData> | undefined,
): Node<TerminalNodeData> {
  if (!existingNode) {
    return persistedNode
  }

  if (isNodeGuardedFromSyncOverwrite(persistedNode.id)) {
    return existingNode
  }

  const isDragging = existingNode.dragging === true
  const persistedSessionId = persistedNode.data.sessionId.trim()
  const existingSessionId = existingNode.data.sessionId.trim()
  const kind = persistedNode.data.kind

  return {
    ...persistedNode,
    ...(isDragging ? { position: existingNode.position, dragging: true } : {}),
    width: existingNode.width,
    height: existingNode.height,
    data: {
      ...persistedNode.data,
      sessionId: persistedSessionId.length > 0 ? persistedSessionId : existingSessionId,
      scrollback: existingNode.data.scrollback ?? persistedNode.data.scrollback,
      agent:
        kind === 'agent'
          ? (existingNode.data.agent ?? persistedNode.data.agent)
          : persistedNode.data.agent,
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
    node => !persistedNodeIds.has(node.id) && isNodeGuardedFromSyncOverwrite(node.id),
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
        ? existing.nodeIds.filter(
            nodeId => !space.nodeIds.includes(nodeId) && isNodeGuardedFromSyncOverwrite(nodeId),
          )
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

  const existingActiveSpaceId = existingWorkspace?.activeSpaceId ?? null
  const resolvedActiveSpaceId =
    existingActiveSpaceId && sanitizedSpaces.some(space => space.id === existingActiveSpaceId)
      ? existingActiveSpaceId
      : hasActiveSpace
        ? workspace.activeSpaceId
        : null

  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    worktreesRoot: workspace.worktreesRoot,
    pullRequestBaseBranchOptions: workspace.pullRequestBaseBranchOptions ?? [],
    nodes,
    viewport: {
      x: existingWorkspace?.viewport.x ?? workspace.viewport.x,
      y: existingWorkspace?.viewport.y ?? workspace.viewport.y,
      zoom: existingWorkspace?.viewport.zoom ?? workspace.viewport.zoom,
    },
    isMinimapVisible: existingWorkspace?.isMinimapVisible ?? workspace.isMinimapVisible,
    spaces: sanitizedSpaces,
    activeSpaceId: resolvedActiveSpaceId,
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
  const refreshScheduledAtMsRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const refreshPendingRef = useRef(false)
  const lastLocalSyncWriteRevisionRef = useRef(0)
  const lastAppliedRevisionRef = useRef(0)
  const pendingSyncWriteRevisionRef = useRef<number | null>(null)
  const pendingFullRefreshRevisionRef = useRef<number | null>(null)
  const needsFullRefreshRef = useRef(false)

  useEffect(() => {
    if (!options.enabled) {
      return
    }

    const handleLocalSyncWrite = (event: Event): void => {
      const revision = (event as CustomEvent<{ revision?: unknown }>).detail?.revision
      if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 0) {
        return
      }

      lastLocalSyncWriteRevisionRef.current = Math.max(
        lastLocalSyncWriteRevisionRef.current,
        Math.floor(revision),
      )
    }

    window.addEventListener(LOCAL_SYNC_WRITE_EVENT_NAME, handleLocalSyncWrite as EventListener)

    function scheduleRefresh(delayMs = 150): void {
      if (refreshInFlightRef.current) {
        refreshPendingRef.current = true
        return
      }

      const normalizedDelay = Math.max(0, Math.floor(delayMs))
      const nextScheduledAt = Date.now() + normalizedDelay

      if (refreshTimerRef.current !== null) {
        const currentScheduledAt = refreshScheduledAtMsRef.current
        if (currentScheduledAt !== null && nextScheduledAt >= currentScheduledAt) {
          return
        }

        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
        refreshScheduledAtMsRef.current = null
      }

      refreshScheduledAtMsRef.current = nextScheduledAt
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        refreshScheduledAtMsRef.current = null
        void runRefresh()
      }, normalizedDelay)
    }

    const syncApi = window.opencoveApi?.sync
    const SYNC_WRITE_EVENT_DELAY_MS = 200
    const unsubscribe =
      typeof syncApi?.onStateUpdated === 'function'
        ? syncApi.onStateUpdated((event: SyncEventPayload) => {
            const eventRevision =
              typeof event.revision === 'number' && Number.isFinite(event.revision)
                ? Math.floor(event.revision)
                : null

            if (
              typeof eventRevision === 'number' &&
              eventRevision <= lastAppliedRevisionRef.current
            ) {
              return
            }

            if (
              event.type === 'app_state.updated' &&
              event.operationId === 'sync.writeState' &&
              typeof event.revision === 'number' &&
              Number.isFinite(event.revision)
            ) {
              const revision = Math.floor(event.revision)
              if (revision <= lastLocalSyncWriteRevisionRef.current) {
                return
              }

              pendingSyncWriteRevisionRef.current =
                pendingSyncWriteRevisionRef.current === null
                  ? revision
                  : Math.max(pendingSyncWriteRevisionRef.current, revision)
              scheduleRefresh(SYNC_WRITE_EVENT_DELAY_MS)
              return
            }

            needsFullRefreshRef.current = true
            if (typeof eventRevision === 'number') {
              pendingFullRefreshRevisionRef.current =
                pendingFullRefreshRevisionRef.current === null
                  ? eventRevision
                  : Math.max(pendingFullRefreshRevisionRef.current, eventRevision)
            }
            scheduleRefresh(60)
          })
        : null

    async function runRefresh(): Promise<void> {
      const pendingSyncWriteRevision = pendingSyncWriteRevisionRef.current
      const shouldRefreshForSyncWrite =
        typeof pendingSyncWriteRevision === 'number' &&
        pendingSyncWriteRevision > lastLocalSyncWriteRevisionRef.current
      const pendingFullRefreshRevision = pendingFullRefreshRevisionRef.current
      const targetRevision = Math.max(
        typeof pendingFullRefreshRevision === 'number' ? pendingFullRefreshRevision : 0,
        shouldRefreshForSyncWrite && typeof pendingSyncWriteRevision === 'number'
          ? pendingSyncWriteRevision
          : 0,
      )

      if (
        (!needsFullRefreshRef.current && !shouldRefreshForSyncWrite) ||
        targetRevision <= lastAppliedRevisionRef.current
      ) {
        pendingSyncWriteRevisionRef.current = null
        pendingFullRefreshRevisionRef.current = null
        return
      }

      refreshInFlightRef.current = true

      try {
        needsFullRefreshRef.current = false
        pendingSyncWriteRevisionRef.current = null
        pendingFullRefreshRevisionRef.current = null

        const persisted = await readPersistedState()
        if (!persisted) {
          return
        }

        useAppStore.getState().setWorkspaces(previous => {
          const currentById = new Map(previous.map(ws => [ws.id, ws] as const))
          return persisted.workspaces.map(workspace =>
            toShellWorkspaceStateForSync(workspace, currentById.get(workspace.id)),
          )
        })

        useAppStore
          .getState()
          .setActiveWorkspaceId(currentActive =>
            resolveNextActiveWorkspaceId(persisted, currentActive),
          )

        lastAppliedRevisionRef.current = Math.max(lastAppliedRevisionRef.current, targetRevision)
      } catch {
        // ignore refresh failures
      } finally {
        refreshInFlightRef.current = false

        if (refreshPendingRef.current) {
          refreshPendingRef.current = false
          scheduleRefresh()
        }
      }
    }

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      refreshScheduledAtMsRef.current = null
      refreshInFlightRef.current = false
      refreshPendingRef.current = false
      unsubscribe?.()
      window.removeEventListener(LOCAL_SYNC_WRITE_EVENT_NAME, handleLocalSyncWrite as EventListener)
    }
  }, [options.enabled])
}
