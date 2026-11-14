import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import { createCanvasStore, type CanvasStore } from './canvasStore'
import type { CanvasUiCommands, CanvasUiState } from './canvasStore.ui'

const CanvasStoreContext = createContext<CanvasStore | null>(null)

interface CanvasStoreEntry {
  readonly workspaceId: string
  readonly store: CanvasStore
}

/** Owns one canvas store per workspace id; a new id gets a new store in the same render. */
export function CanvasStoreProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}): ReactElement {
  const [entry, setEntry] = useState<CanvasStoreEntry>(() => ({
    workspaceId,
    store: createCanvasStore(),
  }))

  let current = entry
  if (entry.workspaceId !== workspaceId) {
    current = { workspaceId, store: createCanvasStore() }
    setEntry(current)
  }

  return <CanvasStoreContext value={current.store}>{children}</CanvasStoreContext>
}

function useCanvasStore(): CanvasStore {
  const store = useContext(CanvasStoreContext)
  if (!store) {
    throw new Error('canvas store hooks need CanvasStoreProvider')
  }
  return store
}

/** Subscribes to the `ui` slice. The selector must return a stored value or a primitive. */
export function useCanvasUi<T>(selector: (ui: CanvasUiState) => T): T {
  const { api } = useCanvasStore()
  return useStore(api, state => selector(state.ui))
}

/** A stable reader for handlers: it does not subscribe, so callers do not re-render. */
export function useReadCanvasUi(): () => CanvasUiState {
  const { api } = useCanvasStore()
  return useCallback(() => api.getState().ui, [api])
}

export function useCanvasUiCommands(): CanvasUiCommands {
  return useCanvasStore().commands.ui
}
