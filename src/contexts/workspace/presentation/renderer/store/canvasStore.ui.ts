import type { ContextMenuState, SpaceActionMenuState } from '../components/workspaceCanvas/types'
import type { CanvasSliceWrite } from './canvasStore'

export interface CanvasUiState {
  readonly contextMenu: ContextMenuState | null
  readonly spaceActionMenu: SpaceActionMenuState | null
}

export interface CanvasUiCommands {
  /** Also clears `spaceActionMenu`, so the two menus are never open together. */
  openContextMenu(menu: ContextMenuState): void
  /** Also clears `contextMenu`. */
  openSpaceActionMenu(menu: SpaceActionMenuState): void
  closeContextMenu(): void
  closeSpaceActionMenu(): void
  closeMenus(): void
}

export function createInitialCanvasUiState(): CanvasUiState {
  return { contextMenu: null, spaceActionMenu: null }
}

export function createCanvasUiCommands(write: CanvasSliceWrite<CanvasUiState>): CanvasUiCommands {
  return {
    openContextMenu: menu => write(ui => ({ ...ui, contextMenu: menu, spaceActionMenu: null })),
    openSpaceActionMenu: menu => write(ui => ({ ...ui, spaceActionMenu: menu, contextMenu: null })),
    closeContextMenu: () =>
      write(ui => (ui.contextMenu === null ? ui : { ...ui, contextMenu: null })),
    closeSpaceActionMenu: () =>
      write(ui => (ui.spaceActionMenu === null ? ui : { ...ui, spaceActionMenu: null })),
    closeMenus: () =>
      write(ui =>
        ui.contextMenu === null && ui.spaceActionMenu === null
          ? ui
          : { ...ui, contextMenu: null, spaceActionMenu: null },
      ),
  }
}
