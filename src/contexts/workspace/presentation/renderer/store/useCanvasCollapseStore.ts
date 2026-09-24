import { create } from 'zustand'
import { getStorage } from '../utils/persistence/storage'
import {
  EMPTY_CANVAS_COLLAPSE,
  normalizeCanvasCollapse,
  type CanvasCollapseState,
} from '../utils/canvasCollapse'

const STORAGE_KEY = 'opencove:canvas-collapse:v1'

function readWorkspaces(): Record<string, CanvasCollapseState> {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(value).map(([id, state]) => [id, normalizeCanvasCollapse(state)]),
    )
  } catch {
    return {}
  }
}

interface CanvasCollapseStore {
  workspaces: Record<string, CanvasCollapseState>
  /** Apply a canonical persisted snapshot when it is available on startup. */
  hydrate: (workspaceId: string, state: CanvasCollapseState) => void
  update: (
    workspaceId: string,
    updater: (state: CanvasCollapseState) => CanvasCollapseState,
  ) => void
}

function persistWorkspaces(workspaces: Record<string, CanvasCollapseState>): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(workspaces))
  } catch {
    // A denied/full local store must not prevent an in-session view change.
  }
}

/** Workspace-scoped disclosure preference with a local cache for responsive updates. */
export const useCanvasCollapseStore = create<CanvasCollapseStore>(set => ({
  workspaces: readWorkspaces(),
  hydrate: (workspaceId, next) =>
    set(state => {
      const previous = state.workspaces[workspaceId]
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
        return state
      }

      const workspaces = { ...state.workspaces, [workspaceId]: next }
      persistWorkspaces(workspaces)
      return { workspaces }
    }),
  update: (workspaceId, updater) =>
    set(state => {
      const previous = state.workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const next = updater(previous)
      if (next === previous) {
        return state
      }
      const workspaces = { ...state.workspaces, [workspaceId]: next }
      persistWorkspaces(workspaces)
      return { workspaces }
    }),
}))
