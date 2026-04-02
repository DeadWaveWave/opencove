import { useEffect, useRef } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useScrollbackStore } from '@contexts/workspace/presentation/renderer/store/useScrollbackStore'
import { scheduleNodeScrollbackWrite } from '@contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
import {
  appendSnapshotData,
  createEmptySnapshotState,
  snapshotToString,
  type SnapshotState,
} from '@shared/pty/snapshot'
import { useAppStore } from '../store/useAppStore'
import { getPtyEventHub } from '../utils/ptyEventHub'

const SCROLLBACK_FLUSH_INTERVAL_MS = 2_000
const SCROLLBACK_PERSIST_DELAY_MS = 2_000

type SessionIndex = Map<string, Set<string>>

function normalizeSessionId(sessionId: string): string | null {
  const normalized = sessionId.trim()
  return normalized.length > 0 ? normalized : null
}

function resolveWorkspaceSessionIndex(workspaces: WorkspaceState[]): SessionIndex {
  const index: SessionIndex = new Map()

  for (const workspace of workspaces) {
    for (const node of workspace.nodes) {
      if (node.data.kind !== 'terminal' && node.data.kind !== 'agent') {
        continue
      }

      const normalizedSessionId = normalizeSessionId(node.data.sessionId)
      if (!normalizedSessionId) {
        continue
      }

      const nodeIds = index.get(normalizedSessionId) ?? new Set<string>()
      nodeIds.add(node.id)
      index.set(normalizedSessionId, nodeIds)
    }
  }

  return index
}

function seedSnapshotFromStore(nodeId: string): SnapshotState {
  const next = createEmptySnapshotState()
  const baseline = useScrollbackStore.getState().scrollbackByNodeId[nodeId] ?? ''
  appendSnapshotData(next, baseline)
  return next
}

export function usePtyWorkspaceScrollbackKeepalive(): void {
  const sessionIndexRef = useRef<SessionIndex>(new Map())
  const snapshotBySessionIdRef = useRef<Map<string, SnapshotState>>(new Map())
  const dirtySessionIdsRef = useRef<Set<string>>(new Set())
  const workspaceSyncTimerRef = useRef<number | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const isDisposedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    isDisposedRef.current = false

    const pty = window.opencoveApi.pty
    const sessionIndex = sessionIndexRef.current
    const snapshots = snapshotBySessionIdRef.current
    const dirtySessionIds = dirtySessionIdsRef.current

    const detachSession = (sessionId: string) => {
      dirtySessionIds.delete(sessionId)
      snapshots.delete(sessionId)
      const detachPromise = pty.detach({ sessionId })
      void detachPromise.catch(() => undefined)
    }

    const attachSession = (sessionId: string, nodeIds: Set<string>) => {
      const firstNodeId = nodeIds.values().next().value
      if (typeof firstNodeId === 'string' && !snapshots.has(sessionId)) {
        snapshots.set(sessionId, seedSnapshotFromStore(firstNodeId))
      }

      const attachPromise = pty.attach({ sessionId })
      void attachPromise.catch(() => undefined)
    }

    const syncWorkspaceSessions = (workspaces: WorkspaceState[]) => {
      const nextIndex = resolveWorkspaceSessionIndex(workspaces)

      for (const [sessionId, nodeIds] of nextIndex.entries()) {
        if (!sessionIndex.has(sessionId)) {
          attachSession(sessionId, nodeIds)
        }

        sessionIndex.set(sessionId, nodeIds)
      }

      for (const sessionId of Array.from(sessionIndex.keys())) {
        if (!nextIndex.has(sessionId)) {
          sessionIndex.delete(sessionId)
          detachSession(sessionId)
        }
      }
    }

    const scheduleWorkspaceSessionSync = () => {
      if (workspaceSyncTimerRef.current !== null) {
        return
      }

      workspaceSyncTimerRef.current = window.setTimeout(() => {
        workspaceSyncTimerRef.current = null
        if (isDisposedRef.current) {
          return
        }
        syncWorkspaceSessions(useAppStore.getState().workspaces)
      }, 200)
    }

    const flushDirtyScrollbacks = () => {
      if (isDisposedRef.current) {
        return
      }

      const pendingSessionIds = Array.from(dirtySessionIds)
      if (pendingSessionIds.length === 0) {
        return
      }

      dirtySessionIds.clear()

      const updatesByNodeId = new Map<string, string>()

      for (const sessionId of pendingSessionIds) {
        const nodeIds = sessionIndex.get(sessionId)
        if (!nodeIds || nodeIds.size === 0) {
          continue
        }

        const snapshot = snapshots.get(sessionId)
        if (!snapshot) {
          continue
        }

        const scrollback = snapshotToString(snapshot)
        if (scrollback.length === 0) {
          continue
        }

        for (const nodeId of nodeIds) {
          updatesByNodeId.set(nodeId, scrollback)
          scheduleNodeScrollbackWrite(nodeId, scrollback, { delayMs: SCROLLBACK_PERSIST_DELAY_MS })
        }
      }

      if (updatesByNodeId.size === 0) {
        return
      }

      useScrollbackStore.setState(state => {
        const record = state.scrollbackByNodeId
        let didChange = false

        for (const [nodeId, scrollback] of updatesByNodeId.entries()) {
          if (record[nodeId] === scrollback) {
            continue
          }

          record[nodeId] = scrollback
          didChange = true
        }

        return didChange ? { scrollbackByNodeId: record } : state
      })
    }

    const scheduleFlushTimer = () => {
      if (flushTimerRef.current !== null) {
        return
      }

      flushTimerRef.current = window.setInterval(() => {
        flushDirtyScrollbacks()
      }, SCROLLBACK_FLUSH_INTERVAL_MS)
    }

    syncWorkspaceSessions(useAppStore.getState().workspaces)
    scheduleFlushTimer()

    const unsubscribeStore = useAppStore.subscribe((nextState, prevState) => {
      if (nextState.workspaces !== prevState.workspaces) {
        scheduleWorkspaceSessionSync()
      }
    })

    const ptyEventHub = getPtyEventHub()
    const unsubscribeData = ptyEventHub.onData(event => {
      const normalizedSessionId = normalizeSessionId(event.sessionId)
      if (!normalizedSessionId || !sessionIndex.has(normalizedSessionId)) {
        return
      }

      const existing = snapshots.get(normalizedSessionId) ?? createEmptySnapshotState()
      appendSnapshotData(existing, event.data)
      snapshots.set(normalizedSessionId, existing)
      dirtySessionIds.add(normalizedSessionId)
    })

    const unsubscribeExit = ptyEventHub.onExit(event => {
      const normalizedSessionId = normalizeSessionId(event.sessionId)
      if (!normalizedSessionId || !sessionIndex.has(normalizedSessionId)) {
        return
      }

      dirtySessionIds.add(normalizedSessionId)
      flushDirtyScrollbacks()
    })

    return () => {
      isDisposedRef.current = true

      unsubscribeStore()
      unsubscribeData()
      unsubscribeExit()

      if (workspaceSyncTimerRef.current !== null) {
        window.clearTimeout(workspaceSyncTimerRef.current)
        workspaceSyncTimerRef.current = null
      }

      if (flushTimerRef.current !== null) {
        window.clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }

      sessionIndex.clear()
      dirtySessionIds.clear()
      snapshots.clear()
    }
  }, [])
}
