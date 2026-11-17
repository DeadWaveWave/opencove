import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  CanvasInteractionCommands,
  CanvasInteractionInitialState,
  CanvasInteractionState,
} from './canvasStore.interaction'
import {
  createCanvasInteractionCommands,
  createInitialCanvasInteractionState,
} from './canvasStore.interaction'
import type { CanvasSelectionCommands, CanvasSelectionState } from './canvasStore.selection'
import {
  createCanvasSelectionCommands,
  createInitialCanvasSelectionState,
} from './canvasStore.selection'
import type { CanvasUiCommands, CanvasUiState } from './canvasStore.ui'
import { createCanvasUiCommands, createInitialCanvasUiState } from './canvasStore.ui'

export interface CanvasStoreState {
  readonly ui: CanvasUiState
  readonly selection: CanvasSelectionState
  readonly interaction: CanvasInteractionState
}

export interface CanvasStoreCommands {
  readonly ui: CanvasUiCommands
  readonly selection: CanvasSelectionCommands
  readonly interaction: CanvasInteractionCommands
}

/** Read-only handle: the raw `setState` of the zustand store is deliberately not part of it. */
export type CanvasStoreReadApi = Pick<
  StoreApi<CanvasStoreState>,
  'getState' | 'getInitialState' | 'subscribe'
>

export interface CanvasStore {
  readonly api: CanvasStoreReadApi
  readonly commands: CanvasStoreCommands
}

/** Applies `recipe` to one slice in one store update; returning the same slice notifies nobody. */
export type CanvasSliceWrite<T> = (recipe: (slice: T) => T) => void

/** One store per mounted canvas: UI projection only, never persisted. */
export function createCanvasStore(initial?: CanvasInteractionInitialState): CanvasStore {
  const store = createStore<CanvasStoreState>()(() => ({
    ui: createInitialCanvasUiState(),
    selection: createInitialCanvasSelectionState(),
    interaction: createInitialCanvasInteractionState(initial),
  }))
  const writeSlice =
    <K extends keyof CanvasStoreState>(key: K): CanvasSliceWrite<CanvasStoreState[K]> =>
    recipe =>
      store.setState(state => {
        const next = recipe(state[key])
        return next === state[key] ? state : { ...state, [key]: next }
      }, true)

  return {
    api: {
      getState: store.getState,
      getInitialState: store.getInitialState,
      subscribe: store.subscribe,
    },
    commands: {
      ui: createCanvasUiCommands(writeSlice('ui')),
      selection: createCanvasSelectionCommands(writeSlice('selection')),
      interaction: createCanvasInteractionCommands(writeSlice('interaction')),
    },
  }
}
