import type {
  ContextMenuState,
  NodeDeleteConfirmationState,
  RoleCreatorState,
  SpaceActionMenuState,
  SpaceTargetMountPickerState,
  TaskEditorState,
} from '../components/workspaceCanvas/types'
import type { CanvasSliceWrite } from './canvasStore'

export interface CanvasUiState {
  readonly contextMenu: ContextMenuState | null
  readonly spaceActionMenu: SpaceActionMenuState | null
  readonly spaceRename: { readonly spaceId: string; readonly draft: string } | null
  readonly spaceTargetMountPicker: SpaceTargetMountPickerState | null
  readonly taskEditor: TaskEditorState | null
  readonly roleCreator: RoleCreatorState | null
  readonly nodeDeleteConfirmation: NodeDeleteConfirmationState | null
}

export type CanvasUiDialogKey =
  | 'spaceTargetMountPicker'
  | 'taskEditor'
  | 'roleCreator'
  | 'nodeDeleteConfirmation'

type DialogValue<K extends CanvasUiDialogKey> = NonNullable<CanvasUiState[K]>

export interface CanvasUiCommands {
  /** Also clears `spaceActionMenu`, so the two menus are never open together. */
  openContextMenu(menu: ContextMenuState): void
  /** Also clears `contextMenu`. */
  openSpaceActionMenu(menu: SpaceActionMenuState): void
  closeContextMenu(): void
  closeSpaceActionMenu(): void
  closeMenus(): void
  openDialog<K extends CanvasUiDialogKey>(key: K, value: DialogValue<K>): void
  /** A no-op while the dialog is closed, so an async completion never reopens it. */
  updateDialog<K extends CanvasUiDialogKey>(
    key: K,
    recipe: (current: DialogValue<K>) => DialogValue<K>,
  ): void
  closeDialog(key: CanvasUiDialogKey): void
  /** Also clears `contextMenu`. */
  startSpaceRename(spaceId: string, draft: string): void
  /** A no-op while no rename is open. */
  setSpaceRenameDraft(draft: string): void
  cancelSpaceRename(): void
}

export function createInitialCanvasUiState(): CanvasUiState {
  return {
    contextMenu: null,
    spaceActionMenu: null,
    spaceRename: null,
    spaceTargetMountPicker: null,
    taskEditor: null,
    roleCreator: null,
    nodeDeleteConfirmation: null,
  }
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
    openDialog: (key, value) => write(ui => ({ ...ui, [key]: value })),
    updateDialog: (key, recipe) =>
      write(ui => {
        const current = ui[key]
        if (current === null) {
          return ui
        }
        const next = recipe(current)
        return next === current ? ui : { ...ui, [key]: next }
      }),
    closeDialog: key => write(ui => (ui[key] === null ? ui : { ...ui, [key]: null })),
    startSpaceRename: (spaceId, draft) =>
      write(ui => ({ ...ui, spaceRename: { spaceId, draft }, contextMenu: null })),
    setSpaceRenameDraft: draft =>
      write(ui =>
        ui.spaceRename === null || ui.spaceRename.draft === draft
          ? ui
          : { ...ui, spaceRename: { ...ui.spaceRename, draft } },
      ),
    cancelSpaceRename: () =>
      write(ui => (ui.spaceRename === null ? ui : { ...ui, spaceRename: null })),
  }
}
