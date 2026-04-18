import { useEffect, useRef } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  PersistedAppState,
  PersistedWorkspaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  readPersistedState,
  toPersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence'
import { useAppStore } from '../store/useAppStore'
import type { SyncEventPayload } from '@shared/contracts/dto'
import { toShellWorkspaceStateForSync } from './workerSync/mergeWorkspaceStateForSync'

const LOCAL_SYNC_WRITE_EVENT_NAME = 'opencove.localSyncWrite'

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
  const refreshScheduledAtMsRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const refreshPendingRef = useRef(false)
  const localSyncWriteRevisionsRef = useRef<Set<number>>(new Set())
  const localSyncWriteRevisionQueueRef = useRef<number[]>([])
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

      const normalizedRevision = Math.floor(revision)
      const trackedRevisions = localSyncWriteRevisionsRef.current
      if (trackedRevisions.has(normalizedRevision)) {
        return
      }

      trackedRevisions.add(normalizedRevision)
      localSyncWriteRevisionQueueRef.current.push(normalizedRevision)

      if (localSyncWriteRevisionQueueRef.current.length > 60) {
        const expired = localSyncWriteRevisionQueueRef.current.shift()
        if (typeof expired === 'number') {
          trackedRevisions.delete(expired)
        }
      }
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
              if (localSyncWriteRevisionsRef.current.has(revision)) {
                localSyncWriteRevisionsRef.current.delete(revision)
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
      const shouldRefreshForSyncWrite = typeof pendingSyncWriteRevision === 'number'
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

        const current = useAppStore.getState()
        if (
          !shouldApplyWorkerSyncRefresh({
            currentState: current,
            persistedState: persisted,
          })
        ) {
          lastAppliedRevisionRef.current = Math.max(lastAppliedRevisionRef.current, targetRevision)
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
          current.setWorkspaces(nextWorkspaces)
        }

        if (nextActiveWorkspaceId !== current.activeWorkspaceId) {
          current.setActiveWorkspaceId(nextActiveWorkspaceId)
        }

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
