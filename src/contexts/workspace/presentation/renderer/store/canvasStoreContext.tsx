import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import { createCanvasStore, type CanvasStore } from './canvasStore'
import type { CanvasInteractionCommands, CanvasInteractionState } from './canvasStore.interaction'
import type { CanvasSelectionCommands, CanvasSelectionState } from './canvasStore.selection'
import type { CanvasUiCommands, CanvasUiState } from './canvasStore.ui'
import { DEFAULT_WORKSPACE_VIEWPORT, type WorkspaceSpaceState } from '../types'
import type { WorkspaceDocument } from './workspaceDocument'
import {
  commitCanvasDocument,
  readWorkspaceDocument,
  requestWorkspaceDocumentPersistFlush,
  type WorkspaceDocumentCommandResult,
} from './workspaceDocumentCommands'

interface CanvasStoreEntry {
  readonly workspaceId: string
  readonly store: CanvasStore
}

const CanvasStoreContext = createContext<CanvasStoreEntry | null>(null)

/** What a canvas reads when its workspace is gone. */
const EMPTY_WORKSPACE_DOCUMENT: WorkspaceDocument = Object.freeze({
  nodes: Object.freeze([]) as unknown as WorkspaceDocument['nodes'],
  spaces: Object.freeze([]) as unknown as WorkspaceDocument['spaces'],
  activeSpaceId: null,
  spaceArchiveRecords: Object.freeze([]) as unknown as WorkspaceDocument['spaceArchiveRecords'],
  viewport: Object.freeze({ ...DEFAULT_WORKSPACE_VIEWPORT }),
  isMinimapVisible: false,
})

/**
 * Owns one canvas store per workspace id; a new id gets a new store in the same render. The store
 * is empty, except for the magnetic-snapping toggle: it is a session preference, so the new store
 * starts with the value the previous one had (Decision 10 of #738).
 */
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
    current = {
      workspaceId,
      store: createCanvasStore({
        magneticSnappingEnabled: entry.store.api.getState().interaction.magneticSnappingEnabled,
      }),
    }
    setEntry(current)
  }

  return <CanvasStoreContext value={current}>{children}</CanvasStoreContext>
}

function useCanvasStoreEntry(): CanvasStoreEntry {
  const entry = useContext(CanvasStoreContext)
  if (!entry) {
    throw new Error('canvas store hooks need CanvasStoreProvider')
  }
  return entry
}

function useCanvasStore(): CanvasStore {
  return useCanvasStoreEntry().store
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

/** Subscribes to the `selection` slice. The selector must return a stored value or a primitive. */
export function useCanvasSelection<T>(selector: (selection: CanvasSelectionState) => T): T {
  const { api } = useCanvasStore()
  return useStore(api, state => selector(state.selection))
}

/** A stable reader for handlers: it does not subscribe, so callers do not re-render. */
export function useReadCanvasSelection(): () => CanvasSelectionState {
  const { api } = useCanvasStore()
  return useCallback(() => api.getState().selection, [api])
}

export function useCanvasSelectionCommands(): CanvasSelectionCommands {
  return useCanvasStore().commands.selection
}

interface InteractionSnapshot<T> {
  readonly api: CanvasStore['api']
  readonly value: T
}

/**
 * Subscribes to the `interaction` slice, and is the one place that decides when a gesture frame
 * renders its subscribers (arm B of #738, "Render priority"). The value lives in React state that
 * the store's `subscribe` sets, so a write from an animation frame renders at default priority,
 * after the frame, as the canvas's own `setState` calls do; a write from a discrete event renders
 * in that event's batch. `useStore` would render every write at sync
 * priority instead, inside the frame, and is deliberately not used here. Every subscriber of the
 * slice goes through this hook, so guides, previews and nodes stay in one lane.
 *
 * The selector must be a module constant that returns a stored value or a primitive. In the
 * render that receives a new store the hook returns that store's value, never the old one's.
 */
export function useCanvasInteraction<T>(selector: (interaction: CanvasInteractionState) => T): T {
  const { api } = useCanvasStore()
  const [snapshot, setSnapshot] = useState<InteractionSnapshot<T>>(() => ({
    api,
    value: selector(api.getState().interaction),
  }))

  useLayoutEffect(() => {
    const sync = (): void => {
      const value = selector(api.getState().interaction)
      setSnapshot(previous =>
        previous.api === api && Object.is(previous.value, value) ? previous : { api, value },
      )
    }

    // A write between the render and this effect never reaches `subscribe`; read once.
    sync()
    return api.subscribe(sync)
  }, [api, selector])

  return snapshot.api === api ? snapshot.value : selector(api.getState().interaction)
}

/** A stable reader for handlers: it does not subscribe, so callers do not re-render. */
export function useReadCanvasInteraction(): () => CanvasInteractionState {
  const { api } = useCanvasStore()
  return useCallback(() => api.getState().interaction, [api])
}

export function useCanvasInteractionCommands(): CanvasInteractionCommands {
  return useCanvasStore().commands.interaction
}

/**
 * A stable reader of this canvas's committed document, as the app store holds it when it is
 * called. It does not subscribe, so callers do not re-render. It is bound to the workspace of the
 * render that created it: a callback made while workspace A was shown keeps reading A after a
 * switch. An empty document when the workspace is gone.
 */
export function useReadCanvasDocument(): () => WorkspaceDocument {
  const { workspaceId } = useCanvasStoreEntry()
  return useCallback(
    () => readWorkspaceDocument(workspaceId) ?? EMPTY_WORKSPACE_DOCUMENT,
    [workspaceId],
  )
}

export interface CanvasDocumentCommands {
  /**
   * Replaces the Spaces with the recipe's result, computed from the store's Spaces as they are
   * when this runs. A recipe that returns the same array writes nothing. `flush` requests the
   * persistence flush after the write, also when nothing changed.
   */
  updateSpaces(
    recipe: (spaces: WorkspaceSpaceState[]) => WorkspaceSpaceState[],
    options?: { flush?: boolean },
  ): WorkspaceDocumentCommandResult
  /** Persistence flush without a document write, for state persisted next to the document. */
  requestPersistFlush(): void
}

/** Document commands of this canvas's workspace; stable until the workspace changes. */
export function useCanvasDocumentCommands(): CanvasDocumentCommands {
  const { workspaceId } = useCanvasStoreEntry()
  return useMemo(
    () => ({
      updateSpaces: (recipe, options) =>
        commitCanvasDocument(
          workspaceId,
          document => {
            const spaces = recipe(document.spaces)
            return spaces === document.spaces ? document : { ...document, spaces }
          },
          options,
        ),
      requestPersistFlush: requestWorkspaceDocumentPersistFlush,
    }),
    [workspaceId],
  )
}
