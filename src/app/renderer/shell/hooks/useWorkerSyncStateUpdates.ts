import {
  getCanonicalRefreshDemand,
  subscribeCanonicalRefresh,
  acknowledgeCanonicalRefresh,
} from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import {
  reconcileCanonicalPublication,
  getPendingPublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { schedulePersistedStateWrite } from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import {
  persistenceScope,
  canAcceptCanonicalState,
  isPublicationBlocked,
  deferRefreshForSubmission,
} from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { content } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import {
  resolveNextActiveWorkspaceId,
  resolveWorkspacesForWorkerSync,
  shouldApplyWorkerSyncRefresh,
} from './workerSync/refreshState'
export {
  resolveWorkspacesForWorkerSync,
  shouldApplyWorkerSyncRefresh,
} from './workerSync/refreshState'
import { useEffect, useRef } from 'react'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  readPersistedStateWithMeta,
  toPersistedState,
  flushScheduledPersistedStateWriteAsync,
} from '@contexts/workspace/presentation/renderer/utils/persistence'
import { useAppStore } from '../store/useAppStore'
import { canonicalContent } from '@shared/sync/mergeValue'
import type { SyncEventPayload } from '@shared/contracts/dto'
import { hasRuntimeBindingPublication } from './workerSync/runtimeSessionBinding'

import {
  acceptWorkerSyncSnapshot,
  registerWorkerSyncPresentation,
} from './workerSync/acceptWorkerSyncSnapshot'

const LOCAL_SYNC_WRITE_EVENT_NAME = 'opencove.localSyncWrite'

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
    let active = true
    const scopeGeneration = persistenceScope()
    const unregisterPresentation = registerWorkerSyncPresentation()
    let failedRefreshes = 0

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

      // A local recovery publication needs a shared-state acknowledgement even though its
      // ordinary sync.writeState echo is suppressed below. Refreshes remain serialized.
      if (
        needsFullRefreshRef.current ||
        hasRuntimeBindingPublication(useAppStore.getState().workspaces)
      ) {
        needsFullRefreshRef.current = true
        pendingFullRefreshRevisionRef.current = Math.max(
          pendingFullRefreshRevisionRef.current ?? 0,
          normalizedRevision,
        )
        scheduleRefresh(0)
      }

      if (localSyncWriteRevisionQueueRef.current.length > 60) {
        const expired = localSyncWriteRevisionQueueRef.current.shift()
        if (typeof expired === 'number') {
          trackedRevisions.delete(expired)
        }
      }
    }

    window.addEventListener(LOCAL_SYNC_WRITE_EVENT_NAME, handleLocalSyncWrite as EventListener)

    function scheduleRefresh(delayMs = 150): void {
      if (!active) {
        return
      }
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

            if (event.type === 'canvas.focus') {
              const store = useAppStore.getState()
              store.setActiveWorkspaceId(event.projectId)
              store.setFocusRequest(prev =>
                event.target.kind === 'node'
                  ? {
                      kind: 'node',
                      workspaceId: event.projectId,
                      nodeId: event.target.nodeId,
                      sequence: (prev?.sequence ?? 0) + 1,
                    }
                  : {
                      kind: 'space',
                      workspaceId: event.projectId,
                      spaceId: event.target.spaceId,
                      sequence: (prev?.sequence ?? 0) + 1,
                    },
              )
              return
            }

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

    const unsubscribeRefresh = subscribeCanonicalRefresh(() => {
      needsFullRefreshRef.current = true
      scheduleRefresh(0)
    })

    async function runRefresh(): Promise<void> {
      const demand = getCanonicalRefreshDemand()
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
        (!demand && !needsFullRefreshRef.current && !shouldRefreshForSyncWrite) ||
        (!demand && targetRevision <= lastAppliedRevisionRef.current)
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

        if (deferRefreshForSubmission()) {
          needsFullRefreshRef.current = true
          pendingFullRefreshRevisionRef.current = Math.max(
            pendingFullRefreshRevisionRef.current ?? 0,
            targetRevision,
          )
          return
        }
        // Publish queued local edits before reading a shared snapshot. A read started
        // before a later local edit cannot acknowledge or replace that edit.
        const localWriteSucceeded =
          demand || getPendingPublication() ? true : await flushScheduledPersistedStateWriteAsync()
        if (!active) {
          return
        }
        if (!localWriteSucceeded) {
          // Keep the refresh pending for a successful local publication, without
          // retrying failed IO in a timer loop or replacing the unsaved edit.
          needsFullRefreshRef.current = true
          pendingFullRefreshRevisionRef.current = Math.max(
            pendingFullRefreshRevisionRef.current ?? 0,
            targetRevision,
          )
          return
        }
        const beforeRead = useAppStore.getState()
        const signatureAtRead = canonicalContent(
          toPersistedState(
            beforeRead.workspaces,
            beforeRead.activeWorkspaceId,
            beforeRead.agentSettings,
          ),
        )
        const snapshot = await readPersistedStateWithMeta()
        const canonical = snapshot.state
        let persisted = canonical
        if (!active || persistenceScope() !== scopeGeneration || !persisted) {
          return
        }
        if (
          !canAcceptCanonicalState(persisted, snapshot.revision) ||
          (typeof snapshot.revision === 'number' &&
            snapshot.revision < Math.max(targetRevision, demand?.minimumRevision ?? 0))
        ) {
          throw new Error('Canonical snapshot is older than the required revision.')
        }
        const currentAtApply = useAppStore.getState()
        const currentPersisted = toPersistedState(
          currentAtApply.workspaces,
          currentAtApply.activeWorkspaceId,
          currentAtApply.agentSettings,
        )
        if (demand || getPendingPublication()) {
          persisted = reconcileCanonicalPublication(persisted, currentPersisted)
        } else if (canonicalContent(currentPersisted) !== signatureAtRead) {
          pendingFullRefreshRevisionRef.current = targetRevision
          needsFullRefreshRef.current = true
          refreshPendingRef.current = true
          return
        }

        // Disclosure preferences and the write cache belong to the same accepted
        // snapshot. A rejected read must not mutate them before these guards.
        const current = useAppStore.getState()
        const scheduleRemainingDelta = () => {
          if (!isPublicationBlocked() && content(persisted!) !== content(canonical!)) {
            schedulePersistedStateWrite(() => {
              const state = useAppStore.getState()
              return toPersistedState(
                state.workspaces,
                state.activeWorkspaceId,
                state.agentSettings,
              )
            })
          }
        }
        if (
          !shouldApplyWorkerSyncRefresh({
            currentState: current,
            persistedState: persisted,
          })
        ) {
          acceptWorkerSyncSnapshot(snapshot, persisted)
          scheduleRemainingDelta()
          if (demand) {
            acknowledgeCanonicalRefresh(demand.generation)
          }
          failedRefreshes = 0
          lastAppliedRevisionRef.current = Math.max(
            lastAppliedRevisionRef.current,
            snapshot.revision ?? 0,
          )
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

        // Apply all shared content atomically before acknowledging its revision. Keep the
        // settings object when its content is unchanged: settings feed the whole shell, and a
        // new identity on every refresh re-renders it under the user's cursor.
        const settingsChanged =
          canonicalContent(normalizeAgentSettings(persisted.settings)) !==
          canonicalContent(normalizeAgentSettings(current.agentSettings))
        useAppStore.setState({
          workspaces: nextWorkspaces,
          activeWorkspaceId: nextActiveWorkspaceId,
          ...(settingsChanged ? { agentSettings: persisted.settings } : {}),
        })
        acceptWorkerSyncSnapshot(snapshot, persisted)
        if (demand) {
          acknowledgeCanonicalRefresh(demand.generation)
        }
        failedRefreshes = 0
        scheduleRemainingDelta()

        lastAppliedRevisionRef.current = Math.max(
          lastAppliedRevisionRef.current,
          snapshot.revision ?? 0,
        )
      } catch {
        needsFullRefreshRef.current = true
        pendingFullRefreshRevisionRef.current = Math.max(
          pendingFullRefreshRevisionRef.current ?? 0,
          targetRevision,
        )
        failedRefreshes++
        // Three bounded attempts; demand remains retained for reconnect or another save.
        if (failedRefreshes < 3) {
          refreshPendingRef.current = true
        }
      } finally {
        if (active) {
          refreshInFlightRef.current = false
          if (refreshPendingRef.current) {
            refreshPendingRef.current = false
            scheduleRefresh(failedRefreshes ? 250 * 2 ** failedRefreshes : 150)
          }
        }
      }
    }

    return () => {
      active = false
      unregisterPresentation()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      refreshScheduledAtMsRef.current = null
      refreshInFlightRef.current = false
      refreshPendingRef.current = false
      unsubscribeRefresh()
      unsubscribe?.()
      window.removeEventListener(LOCAL_SYNC_WRITE_EVENT_NAME, handleLocalSyncWrite as EventListener)
    }
  }, [options.enabled])
}
