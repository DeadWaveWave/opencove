import { useEffect, useRef } from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { SyncPtySessionBindingsInput } from '@shared/contracts/dto'
import { useAppStore } from '../store/useAppStore'

const SYNC_DEBOUNCE_MS = 250

function normalizeSessionId(rawValue: string): string | null {
  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : null
}

function didWorkspaceNodesChange(
  nextWorkspaces: WorkspaceState[],
  prevWorkspaces: WorkspaceState[],
): boolean {
  if (nextWorkspaces.length !== prevWorkspaces.length) {
    return true
  }

  const prevNodesByWorkspaceId = new Map(prevWorkspaces.map(ws => [ws.id, ws.nodes] as const))
  if (prevNodesByWorkspaceId.size !== nextWorkspaces.length) {
    return true
  }

  for (const workspace of nextWorkspaces) {
    if (prevNodesByWorkspaceId.get(workspace.id) !== workspace.nodes) {
      return true
    }
  }

  return false
}

function resolveBindings(workspaces: WorkspaceState[]): SyncPtySessionBindingsInput {
  const bindings: SyncPtySessionBindingsInput['bindings'] = []

  for (const workspace of workspaces) {
    for (const node of workspace.nodes) {
      if (node.data.kind !== 'terminal' && node.data.kind !== 'agent') {
        continue
      }

      const sessionId = normalizeSessionId(node.data.sessionId)
      if (!sessionId) {
        continue
      }

      bindings.push({ sessionId, nodeId: node.id })
    }
  }

  return { bindings }
}

export function usePtySessionBindingsSync(): void {
  const syncTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncSessionBindings = () => {
      const syncFn = window.opencoveApi?.pty?.syncSessionBindings
      if (typeof syncFn !== 'function') {
        return
      }

      const payload = resolveBindings(useAppStore.getState().workspaces)
      void syncFn(payload).catch(() => undefined)
    }

    const scheduleSync = () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current)
      }

      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null
        syncSessionBindings()
      }, SYNC_DEBOUNCE_MS)
    }

    syncSessionBindings()

    const unsubscribe = useAppStore.subscribe((nextState, prevState) => {
      if (didWorkspaceNodesChange(nextState.workspaces, prevState.workspaces)) {
        scheduleSync()
      }
    })

    return () => {
      unsubscribe()

      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }

      const syncFn = window.opencoveApi?.pty?.syncSessionBindings
      if (typeof syncFn === 'function') {
        void syncFn({ bindings: [] }).catch(() => undefined)
      }
    }
  }, [])
}
