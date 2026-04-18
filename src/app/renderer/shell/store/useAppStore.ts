import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type {
  FocusRequest,
  PersistNotice,
  ProjectContextMenuState,
  ProjectDeleteConfirmationState,
  ProjectMountManagerState,
} from '../types'

type SetStateAction<T> = T | ((prev: T) => T)

function applySetStateAction<T>(previous: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (prev: T) => T)(previous) : action
}

export interface AppStoreState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  projectContextMenu: ProjectContextMenuState | null
  projectMountManager: ProjectMountManagerState | null
  projectDeleteConfirmation: ProjectDeleteConfirmationState | null
  isRemovingProject: boolean
  agentSettings: AgentSettings
  isSettingsOpen: boolean
  isProjectCreatorOpen: boolean
  settingsOpenPageId: SettingsPageId | null
  focusRequest: FocusRequest | null
  persistNotice: PersistNotice | null

  setWorkspaces: (action: SetStateAction<WorkspaceState[]>) => void
  setActiveWorkspaceId: (action: SetStateAction<string | null>) => void
  setProjectContextMenu: (action: SetStateAction<ProjectContextMenuState | null>) => void
  setProjectMountManager: (action: SetStateAction<ProjectMountManagerState | null>) => void
  setProjectDeleteConfirmation: (
    action: SetStateAction<ProjectDeleteConfirmationState | null>,
  ) => void
  setIsRemovingProject: (action: SetStateAction<boolean>) => void
  setAgentSettings: (action: SetStateAction<AgentSettings>) => void
  setIsSettingsOpen: (action: SetStateAction<boolean>) => void
  setIsProjectCreatorOpen: (action: SetStateAction<boolean>) => void
  setSettingsOpenPageId: (action: SetStateAction<SettingsPageId | null>) => void
  setFocusRequest: (action: SetStateAction<FocusRequest | null>) => void
  setPersistNotice: (action: SetStateAction<PersistNotice | null>) => void
  reorderWorkspaces: (activeId: string, overId: string) => void
}

export const useAppStore = create<AppStoreState>(set => ({
  workspaces: [],
  activeWorkspaceId: null,
  projectContextMenu: null,
  projectMountManager: null,
  projectDeleteConfirmation: null,
  isRemovingProject: false,
  agentSettings: DEFAULT_AGENT_SETTINGS,
  isSettingsOpen: false,
  isProjectCreatorOpen: false,
  settingsOpenPageId: null,
  focusRequest: null,
  persistNotice: null,

  setWorkspaces: action =>
    set(state => ({ workspaces: applySetStateAction(state.workspaces, action) })),
  setActiveWorkspaceId: action =>
    set(state => ({ activeWorkspaceId: applySetStateAction(state.activeWorkspaceId, action) })),
  setProjectContextMenu: action =>
    set(state => ({ projectContextMenu: applySetStateAction(state.projectContextMenu, action) })),
  setProjectMountManager: action =>
    set(state => ({ projectMountManager: applySetStateAction(state.projectMountManager, action) })),
  setProjectDeleteConfirmation: action =>
    set(state => ({
      projectDeleteConfirmation: applySetStateAction(state.projectDeleteConfirmation, action),
    })),
  setIsRemovingProject: action =>
    set(state => ({ isRemovingProject: applySetStateAction(state.isRemovingProject, action) })),
  setAgentSettings: action =>
    set(state => ({ agentSettings: applySetStateAction(state.agentSettings, action) })),
  setIsSettingsOpen: action =>
    set(state => ({ isSettingsOpen: applySetStateAction(state.isSettingsOpen, action) })),
  setIsProjectCreatorOpen: action =>
    set(state => ({
      isProjectCreatorOpen: applySetStateAction(state.isProjectCreatorOpen, action),
    })),
  setSettingsOpenPageId: action =>
    set(state => ({
      settingsOpenPageId: applySetStateAction(state.settingsOpenPageId, action),
    })),
  setFocusRequest: action =>
    set(state => ({ focusRequest: applySetStateAction(state.focusRequest, action) })),
  setPersistNotice: action =>
    set(state => ({ persistNotice: applySetStateAction(state.persistNotice, action) })),
  reorderWorkspaces: (activeId, overId) =>
    set(state => {
      const oldIndex = state.workspaces.findIndex(workspace => workspace.id === activeId)
      const newIndex = state.workspaces.findIndex(workspace => workspace.id === overId)

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return state
      }

      return { workspaces: arrayMove(state.workspaces, oldIndex, newIndex) }
    }),
}))
